import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const groups = ['a-c', 'd-l', 'm-r', 's-z'];
const [operation, group] = process.argv.slice(2);
const root = resolve(import.meta.dirname, '../..');
const directory = join(import.meta.dirname, '.vitest');
const marker = '/__auto_runtime_test_root__';
const encodedRoot = JSON.stringify(root).slice(1, -1);

function run(argumentsOfVitest: readonly string[], environment: Readonly<NodeJS.ProcessEnv> = process.env): void {
  const result = spawnSync('pnpm', ['exec', 'vitest', 'run', ...argumentsOfVitest], {
    cwd: import.meta.dirname,
    env: environment,
    stdio: 'inherit',
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (operation === 'run' && group !== undefined && groups.includes(group)) {
  const report = join(directory, 'groups', group, 'report.json');
  rmSync(report, { force: true });
  const workers = process.env['CI_SERVER_WORKERS'] ?? process.env['VITEST_MAX_WORKERS'] ?? '2';
  console.log(`Server group ${group}: ${workers} Vitest workers`);
  run(['--config=vitest.groups.ts'], { ...process.env, SERVER_TEST_GROUP: group, VITEST_MAX_WORKERS: workers });
  writeFileSync(report, readFileSync(report, 'utf8').replaceAll(encodedRoot, marker));
} else if (operation === 'merge') {
  const merged = join(directory, 'merged');
  rmSync(merged, { recursive: true, force: true });
  mkdirSync(merged, { recursive: true });
  for (const name of groups) {
    const content = readFileSync(join(directory, 'groups', name, 'report.json'), 'utf8');
    writeFileSync(join(merged, `${name}.json`), content.replaceAll(marker, encodedRoot));
  }
  run([`--merge-reports=${merged}`, '--coverage']);
} else {
  throw new Error('Choose run with a test group, or merge');
}
