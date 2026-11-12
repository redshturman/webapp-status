import http from 'node:http';
import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { describeError, httpResult } from './check-result.js';

export { describeError };

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
      finish(httpResult(response.statusCode, service.acceptedStatusCodes));
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
