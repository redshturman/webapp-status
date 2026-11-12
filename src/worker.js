import { validateConfig } from './validate-config.js';
import { describeError, httpResult } from './check-result.js';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
};

export async function checkService(service, timeoutMs, fetcher = fetch) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result;
  try {
    const response = await fetcher(service.url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'User-Agent': 'webapp-status/1.0', Accept: '*/*' }
    });
    result = httpResult(response.status, service.acceptedStatusCodes);
    if (response.body) await response.body.cancel();
  } catch (error) {
    const detail = controller.signal.aborted
      ? describeError({ code: 'ETIMEDOUT' })
      : describeError(error.cause ?? error);
    result = { state: 'down', statusCode: null, ...detail };
  } finally {
    clearTimeout(timer);
  }
  return {
    name: service.name,
    ...result,
    responseTimeMs: Math.round(performance.now() - started),
    checkedAt: new Date().toISOString()
  };
}

export default {
  async fetch(request, env) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Método no permitido.', {
        status: 405, headers: { ...headers, Allow: 'GET, HEAD' }
      });
    }
    const path = new URL(request.url).pathname;
    if (path === '/api/status') {
      let config;
      try {
        config = validateConfig(env.STATUS_CONFIG);
        if (config.services.length > 6 || config.timeoutSeconds > 8) {
          throw new Error('Workers admite hasta 6 servicios y timeoutSeconds de hasta 8 segundos.');
        }
      } catch (error) {
        console.error(`Configuración de Workers inválida: ${error.message}`);
        return Response.json({ error: 'Configuración de Workers inválida. Consulta los logs.' }, {
          status: 500, headers
        });
      }
      if (request.method === 'HEAD') {
        return new Response(null, {
          headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
      const services = await Promise.all(config.services.map(service =>
        checkService(service, config.timeoutSeconds * 1000)
      ));
      return Response.json({
        ui: config.ui,
        intervalSeconds: config.intervalSeconds,
        timeoutSeconds: config.timeoutSeconds,
        refreshSeconds: config.intervalSeconds,
        services
      }, { headers });
    }
    if (!['/', '/app.js', '/style.css'].includes(path)) {
      return new Response('No encontrado.', { status: 404, headers });
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
};
