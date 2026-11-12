import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';

export function describeError(error) {
  const code = error.code ?? 'UNKNOWN';
  if (code === 'ETIMEDOUT') {
    return { category: 'timeout', explanation: 'Tiempo de espera agotado.' };
  }
  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ENODATA'].includes(code)) {
    return { category: 'dns', explanation: `No se pudo resolver el nombre DNS (${code}).` };
  }
  if (code === 'EPROTO' || /TLS|SSL|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code)) {
    return { category: 'tls', explanation: `Error de conexión segura TLS (${code}).` };
  }
  return { category: 'connection', explanation: `Error de conexión (${code}).` };
}

export function checkService(service, timeoutMs) {
  const started = performance.now();
  return new Promise(resolve => {
    let settled = false;
    let timer;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ...result,
        responseTimeMs: Math.round(performance.now() - started),
        checkedAt: new Date().toISOString()
      });
    };
    const transport = new URL(service.url).protocol === 'https:' ? https : http;
    const request = transport.get(service.url, {
      agent: false,
      headers: { 'User-Agent': 'webapp-status/1.0', Accept: '*/*' }
    }, response => {
      const statusCode = response.statusCode;
      const available = service.acceptedStatusCodes.includes(statusCode);
      let explanation = `HTTP ${statusCode}: ${available ? 'código aceptado' : 'código no aceptado'}.`;
      if (statusCode >= 300 && statusCode < 400) {
        explanation += ' Redirección no seguida; podría ser un acceso SSO.';
      }
      if (statusCode === 401) explanation += ' El servidor requiere autenticación.';
      finish({ state: available ? 'up' : 'down', category: 'http', statusCode, explanation });
      response.destroy();
    });
    request.on('error', error => {
      finish({ state: 'down', statusCode: null, ...describeError(error) });
    });
    // A total deadline also covers DNS, TLS and servers that trickle data.
    timer = setTimeout(() => {
      const error = new Error('Request deadline exceeded');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    }, timeoutMs);
  });
}
