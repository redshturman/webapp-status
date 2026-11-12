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

test('UI renders a single plain-text title and only codes or brief non-HTTP errors', async () => {
  const elements = Object.fromEntries(
    ['#services', '#connection', '#title'].map(id => [id, element()])
  );
  const services = [
    { statusCode: 200, category: 'http', state: 'up' },
    { statusCode: 301, category: 'http', state: 'down' },
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
    [200, 301, 'Tiempo agotado', 'Error DNS', 'Error TLS', 'Error de conexión', 'Pendiente']);

  context.fetch = async () => { throw new Error('offline'); };
  await vm.runInContext('refresh()', context);
  assert.equal(elements['#connection'].hidden, false);
  assert.match(elements['#connection'].textContent, /desactualizados/);
  assert.equal(elements['#services'].classList.contains('stale'), true);
  assert.equal(elements['#services'].children.length, 7);

  context.fetch = async () => ({ ok: true, json: async () => data });
  await vm.runInContext('refresh()', context);
  assert.equal(elements['#connection'].hidden, true);
  assert.equal(elements['#connection'].textContent, '');
  assert.equal(elements['#services'].classList.contains('stale'), false);
});
