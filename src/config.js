import { readFile } from 'node:fs/promises';
import { validateConfig } from './validate-config.js';

export { validateConfig };

export async function loadConfig(path) {
  return validateConfig(JSON.parse(await readFile(path, 'utf8')));
}
