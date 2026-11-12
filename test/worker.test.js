import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import worker, { checkService } from '../src/worker.js';

async function fixture(t) {
  const paths = [];
  const server = http.createServer((request, response) => {
    paths.push(request.url);
    if (request.url === '/slow') return;
    if (request.url === '/headers-only') {
      response.writeHead(200);
      response.flushHeaders();
      return;
    }
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/destination' });
    } else {
      response.writeHead(request.url === '/private' ? 401 : 200);
    }
    response.end('ok');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { url: `http://127.0.0.1:${server.address().port}`, paths };
}

function service(url, acceptedStatusCodes = [200]) {
  return { name: 'Example', url, acceptedStatusCodes };
}

test('Workers checker uses real GETs without following redirects and honors accepted codes', async t => {
  const { url, paths } = await fixture(t);
  for (const [path, codes, expected, status] of [
    ['/', [200], 'up', 200],
    ['/redirect', [200], 'down', 302],
    ['/redirect', [302], 'up', 302],
    ['/private', [200, 401], 'up', 401]
  ]) {
    const result = await checkService(service(`${url}${path}`, codes), 1000);
    assert.equal(result.state, expected);
    assert.equal(result.statusCode, status);
    assert.ok(result.responseTimeMs >= 0);
    assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  }
  assert.ok(!paths.includes('/destination'));
});

test('Workers checker enforces a real deadline and never fabricates an HTTP code', async t => {
  const { url } = await fixture(t);
  const result = await checkService(service(`${url}/slow`), 60);
  assert.equal(result.state, 'down');
  assert.equal(result.category, 'timeout');
  assert.equal(result.statusCode, null);
  assert.ok(result.responseTimeMs >= 40 && result.responseTimeMs < 1000);
});

test('Workers checker stops at headers without waiting for the response body', async t => {
  const { url } = await fixture(t);
  const result = await checkService(service(`${url}/headers-only`), 500);
  assert.equal(result.state, 'up');
  assert.equal(result.statusCode, 200);
});

test('Workers checker distinguishes available error codes without guessing opaque fetch errors', async () => {
  for (const [error, category] of [
    [{ cause: { code: 'ENOTFOUND' } }, 'dns'],
    [{ code: 'CERT_HAS_EXPIRED' }, 'tls'],
    [new TypeError('fetch failed'), 'connection']
  ]) {
    const result = await checkService(service('https://example.com/'), 100,
      async () => { throw error; });
    assert.equal(result.category, category);
    assert.equal(result.state, 'down');
    assert.equal(result.statusCode, null);
  }
});

test('Workers fetch options disable redirects/cache and never forward visitor credentials', async () => {
  let cancelled = false;
  const result = await checkService(service('https://example.com/'), 100, async (url, options) => {
    assert.equal(url, 'https://example.com/');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  assert.equal(cancelled, true);
  assert.equal(result.state, 'up');
});

test('Workers API checks only configured targets per request and serves the same static UI', async t => {
  const { url, paths } = await fixture(t);
  const env = {
    STATUS_CONFIG: { ui: { title: 'Public demo' }, services: [service(url)] },
    ASSETS: { fetch: async request => new Response(new URL(request.url).pathname === '/' ? 'page' : 'asset') }
  };
  const request = new Request('https://panel.example/api/status?url=https://ignored.example/', {
    headers: { Authorization: 'visitor-only', Cookie: 'visitor-only' }
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.text();
  const data = JSON.parse(body);
  assert.equal(data.ui.title, 'Public demo');
  assert.equal(data.refreshSeconds, 30);
  assert.equal(data.services[0].state, 'up');
  assert.equal(body.includes(url), false);
  assert.equal(paths.length, 1);
  await worker.fetch(request, env);
  assert.equal(paths.length, 2);
  const head = await worker.fetch(new Request(request, { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(paths.length, 2);
  const asset = await worker.fetch(new Request('https://panel.example/'), env);
  assert.equal(await asset.text(), 'page');
  assert.match(asset.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/config.json', '/api/check', '/unknown']) {
    assert.equal((await worker.fetch(new Request(`https://panel.example${path}`), env)).status, 404);
  }
  assert.equal((await worker.fetch(new Request(request, { method: 'POST' }), env)).status, 405);
});

test('Workers rejects missing/invalid or oversized configuration explicitly', async t => {
  const logged = [];
  t.mock.method(console, 'error', message => logged.push(message));
  for (const config of [
    undefined,
    { services: [] },
    { services: [service('https://example.com/')], timeoutSeconds: 9 },
    { services: Array.from({ length: 7 }, (_, index) => ({
      ...service('https://example.com/'), name: `Service ${index}`
    })) }
  ]) {
    const response = await worker.fetch(new Request('https://panel.example/api/status'), {
      STATUS_CONFIG: config
    });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /Configuración/);
  }
  assert.equal(logged.length, 4);
});
