import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface RejectedProbe {
  readonly because: string;
  readonly source: readonly string[];
}

export interface Probes {
  readonly accepted: Readonly<Record<string, readonly string[]>>;
  readonly rejected: Readonly<Record<string, RejectedProbe>>;
}

export const probeHeader: readonly string[] = [
  "import { Effect, Schema } from 'effect';",
  "import * as Operations from '../../../src/index.ts';",
  'const Empty = Schema.Record(Schema.String, Schema.Never);',
  "const about = { title: 'Probe', description: 'Probe.' };",
];

export function compiledErrors(fixture: string, { accepted, rejected }: Probes): readonly string[] {
  const directory = fileURLToPath(new URL(`../../node_modules/.cache/${fixture}/`, import.meta.url));
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [file, source] of Object.entries(accepted)) {
    writeFileSync(`${directory}${file}`, source.join('\n'));
  }
  for (const [file, { source }] of Object.entries(rejected)) {
    writeFileSync(`${directory}${file}`, source.join('\n'));
  }
  writeFileSync(
    `${directory}tsconfig.json`,
    JSON.stringify({ extends: '../../../../../tsconfig.base.json', include: ['*.ts'] }),
  );
  const compiler = fileURLToPath(new URL('bin/tsc', import.meta.resolve('typescript/package.json')));
  const { stdout } = spawnSync(process.execPath, [compiler, '--pretty', 'false'], { cwd: directory, encoding: 'utf8' });
  return stdout.split(/\n(?=\S)/u).filter((error) => error.includes('error TS'));
}
