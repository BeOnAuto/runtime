import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ModuleAddress } from '@on.auto/workflow-engine/dsl';
import { expect, vi } from 'vitest';

import { scratchDirectory } from '../testing/scratch.ts';

export type Script =
  | 'real'
  | 'shifted'
  | 'held'
  | 'sleeps'
  | 'exits'
  | 'allocates'
  | 'garbage'
  | 'badly'
  | 'not-finite'
  | 'walks-low-above'
  | 'low-above'
  | 'high-below'
  | 'unreadable';

export interface ScriptedModels {
  readonly module: ModuleAddress;
  readonly next: (script: Script) => void;
  readonly untilSleeping: (jobs: readonly string[]) => Promise<void>;
}

interface ScriptFiles {
  readonly script: string;
  readonly nextScript: string;
  readonly sleeping: string;
}

const waiting = { timeout: 25_000, interval: 20 };

const processLoop = import.meta.resolve('@on.auto/workflow-engine/process-loop');

const realJobs = new URL('../model-jobs/model-jobs.ts', import.meta.url).href;

const scriptFile = 'script';

const nextScriptFile = 'script.next';

const sleepingFile = 'sleeping';

function sourceOf(): string {
  return [
    "import { appendFileSync, readFileSync } from 'node:fs';",
    `import { serveProcessJobs } from '${processLoop}';`,
    `import { modelJobs } from '${realJobs}';`,
    `const scriptFile = new URL('./${scriptFile}', import.meta.url);`,
    `const sleepingFile = new URL('./${sleepingFile}', import.meta.url);`,
    'const real = modelJobs();',
    'const scripts = {',
    '  real: (kind, payload) => real[kind](payload),',
    '  shifted: async (kind, payload) => {',
    '    const answer = await real[kind](payload);',
    "    return kind === 'walk' ? { series: answer.series, q: answer.q.map((q) => q.map((value) => value + 100)) } : answer;",
    '  },',
    '  held: async (kind, payload) => {',
    "    appendFileSync(sleepingFile, kind + '\\n');",
    "    while (scriptOf() === 'held') await new Promise((resolve) => setTimeout(resolve, 10));",
    '    return real[kind](payload);',
    '  },',
    '  sleeps: (kind) => {',
    "    appendFileSync(sleepingFile, kind + '\\n');",
    '    return new Promise(() => {});',
    '  },',
    '  exits: () => process.exit(3),',
    "  allocates: () => { throw new RangeError('Array buffer allocation failed'); },",
    '  garbage: () => ({ nonsense: true }),',
    "  badly: () => ({ badly: 'The scripted model answered badly' }),",
    "  unreadable: () => { throw new Error('The rows could not be read'); },",
    "  'not-finite': async (kind, payload) => {",
    "    if (kind !== 'walk') return { q: new Float32Array(6).fill(Number.NaN), dims: [1, 2, 3] };",
    '    const answer = await real.walk(payload);',
    '    return { series: answer.series, q: answer.q.map((q) => q.map(() => Number.NaN)) };',
    '  },',
    "  'walks-low-above': async (kind, payload) => {",
    '    const answer = await real[kind](payload);',
    "    return kind === 'walk' ? { series: answer.series, q: answer.q.map((q) => q.map((value, place) => (place % 3 === 0 ? value + 1000 : value))) } : answer;",
    '  },',
    "  'low-above': () => ({ q: Float32Array.of(12, 11, 13, 9, 11, 13), dims: [1, 2, 3] }),",
    "  'high-below': () => ({ q: Float32Array.of(9, 11, 13, 9, 11, 10), dims: [1, 2, 3] }),",
    '};',
    "const scriptOf = () => readFileSync(scriptFile, 'utf8');",
    'const scripted = (kind) => (payload) => scripts[scriptOf()](kind, payload);',
    "const window = (payload) => (scriptOf() === 'unreadable' ? scripts.unreadable() : real.window(payload));",
    "serveProcessJobs({ check: scripted('check'), run: scripted('run'), walk: scripted('walk'), window, baselines: scripted('baselines') }, process);",
  ].join('\n');
}

function scriptNamed(files: ScriptFiles, script: Script): void {
  writeFileSync(files.nextScript, script);
  renameSync(files.nextScript, files.script);
}

function sleepingIn(files: ScriptFiles): readonly string[] {
  return readFileSync(files.sleeping, 'utf8').split('\n').slice(0, -1);
}

export function scriptedModels(): ScriptedModels {
  const directory = scratchDirectory();
  const files = {
    script: join(directory, scriptFile),
    nextScript: join(directory, nextScriptFile),
    sleeping: join(directory, sleepingFile),
  };
  const module = pathToFileURL(join(directory, 'scripted-model-process.mjs'));
  scriptNamed(files, 'real');
  writeFileSync(files.sleeping, '');
  writeFileSync(module, sourceOf());
  return {
    module: () => module,
    next: (script) => {
      scriptNamed(files, script);
    },
    untilSleeping: (jobs) =>
      vi.waitFor(() => {
        expect(sleepingIn(files)).toEqual(jobs);
      }, waiting),
  };
}
