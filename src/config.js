import { readFile } from 'node:fs/promises';

export function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('La configuración debe ser un objeto JSON.');
  }

  const intervalSeconds = input.intervalSeconds ?? 30;
  const timeoutSeconds = input.timeoutSeconds ?? 5;
  for (const [name, value] of Object.entries({ intervalSeconds, timeoutSeconds })) {
    if (!Number.isInteger(value) || value < 1 || value > 2147483) {
      throw new Error(`${name} debe ser un entero entre 1 y 2147483 segundos.`);
    }
  }
  if (!Array.isArray(input.services) || input.services.length === 0) {
    throw new Error('services debe contener al menos un servicio.');
  }

  const names = new Set();
  const services = input.services.map((service, index) => {
    const label = `services[${index}]`;
    if (!service || typeof service.name !== 'string' || !service.name.trim()) {
      throw new Error(`${label}.name debe ser un texto no vacío.`);
    }
    const name = service.name.trim();
    if (names.has(name)) throw new Error(`Nombre de servicio duplicado: ${name}`);
    names.add(name);

    let url;
    try {
      if (typeof service.url !== 'string') throw new Error();
      url = new URL(service.url);
    } catch {
      throw new Error(`${label}.url debe ser una URL HTTP o HTTPS válida.`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      throw new Error(`${label}.url debe usar HTTP/HTTPS, sin credenciales ni fragmentos.`);
    }
    const acceptedStatusCodes = service.acceptedStatusCodes ?? [200];
    if (!Array.isArray(acceptedStatusCodes) || acceptedStatusCodes.length === 0 ||
        !acceptedStatusCodes.every(code => Number.isInteger(code) && code >= 100 && code <= 599)) {
      throw new Error(`${label}.acceptedStatusCodes debe ser una lista de códigos HTTP (100-599).`);
    }
    return { name, url: url.href, acceptedStatusCodes };
  });
  return { intervalSeconds, timeoutSeconds, services };
}

export async function loadConfig(path) {
  return validateConfig(JSON.parse(await readFile(path, 'utf8')));
}
