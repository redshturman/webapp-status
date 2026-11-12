import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { createMonitor } from './monitor.js';

const publicFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8']
};

export async function createApp(config) {
  const monitor = createMonitor(config);
  const assets = new Map(await Promise.all(
    Object.entries(publicFiles).map(async ([route, [file, type]]) => [
      route, { type, body: await readFile(new URL(`../public/${file}`, import.meta.url)) }
    ])
  ));
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy',
      "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Método no permitido.');
      return;
    }
    const path = request.url.split('?')[0];
    if (path === '/api/status') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(monitor.snapshot()));
      return;
    }
    const asset = assets.get(path);
    if (!asset) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('No encontrado.');
      return;
    }
    response.writeHead(200, { 'Content-Type': asset.type });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
  });
  return { server, monitor };
}

async function main() {
  const config = await loadConfig(process.env.CONFIG_PATH || 'config.json');
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  const { server, monitor } = await createApp(config);
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolveListen);
  });
  console.log(`Panel disponible en el puerto ${port}. ${config.services.length} servicios configurados.`);
  monitor.start().catch(fatal);
  const shutdown = () => {
    server.close(error => {
      if (error) fatal(error);
    });
    monitor.stop().catch(fatal);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function fatal(error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(fatal);
}
