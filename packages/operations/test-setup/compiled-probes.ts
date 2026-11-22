import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { TestProject } from 'vitest/node';

import { handlerProbes } from '../src/definition/handler-probes.ts';
import { httpProbes } from '../src/definition/http-probes.ts';
import type { Probes } from '../src/testing/compiled-probes.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    readonly compiledProbes: Readonly<Record<string, readonly string[]>>;
  }
}

const separator = '--';

/** The sets of probes compiled at once, each under its name, as one run of the compiler answers their errors. */
async function compiledProbeSets(
  sets: Readonly<Record<string, Probes>>,
): Promise<Readonly<Record<string, readonly string[]>>> {
  const directory = fileURLToPath(new URL('../node_modules/.cache/compiled-probes/', import.meta.url));
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  for (const [set, { accepted, rejected }] of Object.entries(sets)) {
    for (const [file, source] of Object.entries(accepted)) {
      writeFileSync(`${directory}${set}${separator}${file}`, source.join('\n'));
    }
    for (const [file, { source }] of Object.entries(rejected)) {
      writeFileSync(`${directory}${set}${separator}${file}`, source.join('\n'));
    }
  }
  writeFileSync(
    `${directory}tsconfig.json`,
    JSON.stringify({ extends: '../../../../../tsconfig.base.json', include: ['*.ts'] }),
  );
  const compiler = fileURLToPath(new URL('bin/tsc', import.meta.resolve('typescript/package.json')));
  const child = spawn(process.execPath, [compiler, '--pretty', 'false'], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  await once(child, 'close');
  const errors = stdout.split(/\n(?=\S)/u).filter((error) => error.includes('error TS'));
  return Object.fromEntries(
    Object.keys(sets).map((set) => [
      set,
      errors
        .filter((error) => error.startsWith(`${set}${separator}`))
        .map((error) => error.slice(set.length + separator.length)),
    ]),
  );
}

/** Compiles every probe of the rules a definition is held to in one run of the compiler, once for the test run. */
export default async function setup({ provide }: Pick<TestProject, 'provide'>): Promise<void> {
  provide('compiledProbes', await compiledProbeSets({ 'http-rules': httpProbes, 'handler-rules': handlerProbes }));
}
