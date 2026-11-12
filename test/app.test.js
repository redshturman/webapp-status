import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { validateConfig } from '../src/config.js';
import { checkService, describeError } from '../src/checker.js';
import { createMonitor } from '../src/monitor.js';
import { createApp } from '../src/server.js';

async function listen(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections?.();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function configFor(url, extra = {}) {
  return validateConfig({ services: [{ name: 'Local', url }], ...extra });
}

test('config defaults and explicit accepted codes', () => {
  const config = configFor('https://example.com');
  assert.equal(config.intervalSeconds, 30);
  assert.equal(config.timeoutSeconds, 5);
  assert.deepEqual(config.services[0].acceptedStatusCodes, [200]);
  assert.deepEqual(validateConfig({
    services: [{ name: 'Private API', url: 'https://example.com', acceptedStatusCodes: [200, 401] }]
  }).services[0].acceptedStatusCodes, [200, 401]);
});

test('UI settings preserve defaults and accept per-site text', () => {
  const config = configFor('https://example.com');
  assert.deepEqual(config.ui, { eyebrow: 'DISPONIBILIDAD HTTP', title: 'Estado de servicios' });
  assert.deepEqual(configFor('https://example.com', { ui: { title: ' Sede norte ' } }).ui,
    { eyebrow: 'DISPONIBILIDAD HTTP', title: 'Sede norte' });
  assert.deepEqual(configFor('https://example.com', {
    ui: { title: '<b>Panel</b>', eyebrow: 'SITIO A' }
  }).ui, { title: '<b>Panel</b>', eyebrow: 'SITIO A' });
  for (const ui of [null, [], 'invalid', { title: '' }, { eyebrow: 4 }]) {
    assert.throws(() => configFor('https://example.com', { ui }));
  }
});

for (const [label, invalid] of [
  ['empty service list', { services: [] }],
  ['missing name', { services: [{ url: 'https://example.com' }] }],
  ['non-HTTP URL', { services: [{ name: 'A', url: 'file:///etc/hosts' }] }],
  ['malformed URL', { services: [{ name: 'A', url: 'not a URL' }] }],
  ['URL credentials', { services: [{ name: 'A', url: 'https://user:pass@example.com' }] }],
  ['URL fragment', { services: [{ name: 'A', url: 'https://example.com/#fragment' }] }],
  ['invalid code', { services: [{ name: 'A', url: 'https://example.com', acceptedStatusCodes: ['200'] }] }],
  ['empty codes', { services: [{ name: 'A', url: 'https://example.com', acceptedStatusCodes: [] }] }],
  ['duplicate names', { services: [{ name: 'A', url: 'https://example.com' }, { name: ' A ', url: 'https://example.org' }] }],
  ['zero timeout', { services: [{ name: 'A', url: 'https://example.com' }], timeoutSeconds: 0 }],
  ['timer overflow', { services: [{ name: 'A', url: 'https://example.com' }], intervalSeconds: 2147484 }]
]) {
  test(`configuration rejects ${label}`, () => assert.throws(() => validateConfig(invalid)));
}

test('HTTP accepted, rejected and authentication responses', async t => {
  const url = await listen(t, http.createServer((request, response) => {
    response.writeHead(Number(request.url.slice(1)));
    response.end();
  }));
  for (const [code, accepted, expected] of [
    [200, [200], 'up'], [503, [200], 'down'], [401, [200], 'down'], [401, [200, 401], 'up']
  ]) {
    const result = await checkService({ url: `${url}/${code}`, acceptedStatusCodes: accepted }, 500);
    assert.equal(result.state, expected);
    assert.equal(result.statusCode, code);
    assert.equal(result.category, 'http');
    assert.ok(result.responseTimeMs >= 0);
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
    if (code === 401) assert.match(result.explanation, /autenticación/);
  }
});

test('redirects are not followed even when explicitly accepted', async t => {
  let destinationCalls = 0;
  const url = await listen(t, http.createServer((request, response) => {
    if (request.url === '/login') destinationCalls++;
    response.writeHead(302, { Location: '/login' });
    response.end();
  }));
  const rejected = await checkService({ url, acceptedStatusCodes: [200] }, 500);
  const accepted = await checkService({ url, acceptedStatusCodes: [302] }, 500);
  assert.equal(rejected.state, 'down');
  assert.equal(accepted.state, 'up');
  assert.match(accepted.explanation, /Redirección no seguida/);
  assert.equal(destinationCalls, 0);
});

test('availability ends at headers, without waiting for a response body', async t => {
  const url = await listen(t, http.createServer((request, response) => {
    response.writeHead(200);
    response.flushHeaders();
  }));
  const result = await checkService({ url, acceptedStatusCodes: [200] }, 200);
  assert.equal(result.state, 'up');
});

test('total deadline covers a server that never sends headers', async t => {
  const url = await listen(t, http.createServer(() => {}));
  const result = await checkService({ url, acceptedStatusCodes: [200] }, 80);
  assert.equal(result.state, 'down');
  assert.equal(result.category, 'timeout');
  assert.equal(result.statusCode, null);
  assert.ok(result.responseTimeMs >= 60 && result.responseTimeMs < 1000);
});

test('connection refusal is distinguished from timeout', async () => {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  await new Promise(resolve => server.close(resolve));
  const result = await checkService({ url, acceptedStatusCodes: [200] }, 500);
  assert.equal(result.category, 'connection');
  assert.match(result.explanation, /ECONNREFUSED/);
});

test('TLS handshake failures are distinguished from connection errors', async t => {
  const server = net.createServer(socket => {
    socket.once('data', () => socket.end('HTTP/1.1 200 OK\r\n\r\n'));
  });
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  const url = await listen(t, server);
  t.after(() => { for (const socket of sockets) socket.destroy(); });
  const result = await checkService({
    url: url.replace('http:', 'https:'), acceptedStatusCodes: [200]
  }, 1000);
  assert.equal(result.state, 'down');
  assert.equal(result.category, 'tls');
});

test('DNS and certificate errors retain meaningful categories', () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN']) {
    assert.equal(describeError({ code }).category, 'dns');
  }
  for (const code of ['DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
    assert.equal(describeError({ code }).category, 'tls');
  }
});

test('monitor starts pending, updates results and schedules another round', async t => {
  let calls = 0;
  const url = await listen(t, http.createServer((request, response) => {
    calls++;
    response.writeHead(calls === 1 ? 200 : 503);
    response.end();
  }));
  const monitor = createMonitor(configFor(url, { intervalSeconds: 1 }));
  t.after(() => monitor.stop());
  const pending = monitor.snapshot().services[0];
  assert.equal(pending.state, 'pending');
  assert.equal(pending.checkedAt, null);
  assert.equal(pending.responseTimeMs, null);
  await monitor.start();
  assert.equal(monitor.snapshot().services[0].state, 'up');
  const deadline = Date.now() + 3000;
  while (monitor.snapshot().services[0].state !== 'down' && Date.now() < deadline) {
    await delay(20);
  }
  assert.equal(monitor.snapshot().services[0].state, 'down');
  await monitor.stop();
  const stoppedCalls = calls;
  await delay(1100);
  assert.equal(calls, stoppedCalls);
});

test('API and page expose fixed routes only and never accept visitor destinations', async t => {
  let targetCalls = 0;
  const target = await listen(t, http.createServer((request, response) => {
    targetCalls++;
    response.end('ok');
  }));
  const { server, monitor } = await createApp(configFor(target, {
    ui: { title: 'Sede norte', eyebrow: 'SERVICIOS' }
  }));
  const url = await listen(t, server);
  t.after(() => monitor.stop());
  const pending = await fetch(`${url}/api/status?url=${encodeURIComponent(target)}`);
  assert.equal(pending.status, 200);
  assert.equal((await pending.json()).services[0].state, 'pending');
  assert.equal(targetCalls, 0);
  await monitor.start();
  const response = await fetch(`${url}/api/status`);
  const body = await response.text();
  assert.equal(JSON.parse(body).services[0].state, 'up');
  assert.deepEqual(JSON.parse(body).ui, { title: 'Sede norte', eyebrow: 'SERVICIOS' });
  assert.ok(!body.includes(target));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const page = await fetch(url);
  assert.match(await page.text(), /Estado de servicios/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${url}/app.js`)).status, 200);
  assert.equal((await fetch(`${url}/style.css`)).status, 200);
  assert.equal((await fetch(`${url}/api/check?url=${encodeURIComponent(target)}`)).status, 404);
  assert.equal((await fetch(`${url}/config.json`)).status, 404);
  assert.equal((await fetch(`${url}/api/status`, { method: 'POST' })).status, 405);
  const head = await fetch(`${url}/api/status`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(targetCalls, 1);
});
