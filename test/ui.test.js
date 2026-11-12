import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function element() {
  const classes = new Set();
  return {
    children: [], textContent: '', hidden: false,
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      contains: value => classes.has(value)
    },
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; }
  };
}

test('UI renders brief HTTP descriptions independently of availability and preserves non-HTTP errors', async () => {
  const elements = Object.fromEntries(
    ['#services', '#connection', '#title'].map(id => [id, element()])
  );
  const services = [
    { statusCode: 200, category: 'http', state: 'up' },
    { statusCode: 302, category: 'http', state: 'down' },
    { statusCode: 401, category: 'http', state: 'up' },
    { statusCode: 401, category: 'http', state: 'down' },
    { statusCode: 403, category: 'http', state: 'down' },
    { statusCode: 404, category: 'http', state: 'down' },
    { statusCode: 503, category: 'http', state: 'down' },
    { statusCode: 599, category: 'http', state: 'down' },
    ...['timeout', 'dns', 'tls', 'connection', 'pending'].map(category => ({
      statusCode: null, category, state: category === 'pending' ? 'pending' : 'down'
    }))
  ].map(service => ({
    name: 'Servicio', explanation: 'Do not display this long explanation',
    responseTimeMs: null, checkedAt: null, ...service
  }));
  const data = { ui: { title: '<b>Sede norte</b>', eyebrow: 'RED INTERNA' }, services };
  const document = {
    querySelector: id => elements[id],
    createElement: element,
    title: ''
  };
  const context = vm.createContext({
    document, AbortSignal, setTimeout() {},
    fetch: async () => ({ ok: true, json: async () => data })
  });
  await vm.runInContext(`${script}\nrefresh();`, context);
  assert.equal(document.title, '<b>Sede norte</b>');
  assert.equal(elements['#title'].textContent, data.ui.title);
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /eyebrow/);
  assert.equal(elements['#connection'].hidden, true);
  assert.deepEqual(elements['#services'].children.map(row => row.children[2].textContent),
    ['200 · OK', '302 · Redirección', '401 · Requiere autenticación',
      '401 · Requiere autenticación', '403 · Acceso denegado', '404 · No encontrado',
      '503 · Servicio no disponible', '599',
      'Tiempo agotado', 'Error DNS', 'Error TLS', 'Error de conexión', 'Pendiente']);
  const rows = elements['#services'].children;
  assert.equal(rows[2].children[1].children[0].textContent, 'Disponible');
  assert.equal(rows[3].children[1].children[0].textContent, 'No disponible');

  context.fetch = async () => { throw new Error('offline'); };
  await vm.runInContext('refresh()', context);
  assert.equal(elements['#connection'].hidden, false);
  assert.match(elements['#connection'].textContent, /desactualizados/);
  assert.equal(elements['#services'].classList.contains('stale'), true);
  assert.equal(elements['#services'].children.length, services.length);

  context.fetch = async () => ({ ok: true, json: async () => data });
  await vm.runInContext('refresh()', context);
  assert.equal(elements['#connection'].hidden, true);
  assert.equal(elements['#connection'].textContent, '');
  assert.equal(elements['#services'].classList.contains('stale'), false);
});
