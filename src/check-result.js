export function httpResult(statusCode, acceptedStatusCodes) {
  const available = acceptedStatusCodes.includes(statusCode);
  let explanation = `HTTP ${statusCode}: ${available ? 'código aceptado' : 'código no aceptado'}.`;
  if (statusCode >= 300 && statusCode < 400) {
    explanation += ' Redirección no seguida; podría ser un acceso SSO.';
  }
  if (statusCode === 401) explanation += ' El servidor requiere autenticación.';
  return { state: available ? 'up' : 'down', category: 'http', statusCode, explanation };
}

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
