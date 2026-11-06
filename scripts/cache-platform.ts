import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const folder = resolve('.turbo');
mkdirSync(folder, { recursive: true });
const temporary = resolve(folder, `platform-${process.pid}.json`);
writeFileSync(
  temporary,
  `${JSON.stringify({ platform: process.platform, arch: process.arch, node: process.versions.node })}\n`,
);
renameSync(temporary, resolve(folder, 'platform.json'));
