import { resolve } from 'node:path';
import { buildApi } from './api.ts';
import { config, hasModelAccess } from './config.ts';
import { Store } from './db.ts';
import { RunManager } from './runs.ts';

const store = new Store(resolve(config.dataDir, config.dbFile));
const runs = new RunManager(store);
const app = await buildApi(runs);
runs.start();

await app.listen({ port: config.port, host: config.host });
console.log(`[microcity] server http://${config.host}:${config.port}  models=${hasModelAccess() ? 'on' : 'off'}  jev=${config.jevModel}  gen=${config.genModel}`);

const shutdown = async () => {
  runs.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
