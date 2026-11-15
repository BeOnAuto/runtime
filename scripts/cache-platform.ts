import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const folder = resolve('.turbo');
const services = resolve(folder, 'services');
mkdirSync(services, { recursive: true });

function written(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  renameSync(temporary, path);
}

written(resolve(folder, 'platform.json'), {
  platform: process.platform,
  arch: process.arch,
  node: process.versions.node,
});
for (const [service, variable] of [
  ['postgresql', 'LEDGER_TEST_POSTGRESQL_URL'],
  ['object-store', 'CONTENT_TEST_OBJECT_STORE_URL'],
] as const)
  written(resolve(services, `${service}.json`), { configured: Boolean(process.env[variable]) });
