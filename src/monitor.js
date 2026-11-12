import { checkService } from './checker.js';

export function createMonitor(config) {
  let results = config.services.map(service => ({
    name: service.name,
    state: 'pending',
    category: 'pending',
    explanation: 'Pendiente de la primera comprobación.',
    statusCode: null,
    responseTimeMs: null,
    checkedAt: null
  }));
  let running = false;
  let timer;
  let cycle;

  async function checkAll() {
    await Promise.all(config.services.map(async (service, index) => {
      const result = await checkService(service, config.timeoutSeconds * 1000);
      results[index] = { name: service.name, ...result };
    }));
    if (running) timer = setTimeout(run, config.intervalSeconds * 1000);
  }

  function run() {
    cycle = checkAll();
    return cycle;
  }

  return {
    snapshot() {
      return {
        intervalSeconds: config.intervalSeconds,
        timeoutSeconds: config.timeoutSeconds,
        services: results.map(result => ({ ...result }))
      };
    },
    start() {
      if (running) return cycle;
      running = true;
      return run();
    },
    async stop() {
      running = false;
      clearTimeout(timer);
      await cycle;
    }
  };
}
