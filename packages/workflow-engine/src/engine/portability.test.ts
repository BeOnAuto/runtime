import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { modulesReachedFrom } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { freezingPreludeSource, preludeSource } from '../programs/sandbox-prelude.ts';

interface Forbidden {
  readonly what: string;
  readonly pattern: Readonly<RegExp>;
}

const source = fileURLToPath(new URL('..', import.meta.url));

const importedEverywhere: ReadonlySet<string> = new Set(['effect', '@on.auto/operations', '@on.auto/ledger']);

const importedInAFolder: ReadonlyMap<string, readonly string[]> = new Map([
  ['programs/', ['quickjs-emscripten-core']],
  ['program-pool/', ['node:url', 'node:worker_threads']],
  ['process-pool/', ['node:buffer', 'node:child_process', 'node:fs', 'node:path', 'node:url']],
  ['instances/', ['quickjs-emscripten-core', '@jitl/quickjs-wasmfile-release-sync']],
]);

const quickJs = 'quickjs-emscripten-core';

const importSpecifier = /^\s*(?:import|export)\s(?:[^;'"]*?\bfrom\s*)?['"]([^'"]+)['"]/gmu;

const quickJsImport = /^\s*import\s(type\s)?[^;'"]*?\bfrom\s*['"]quickjs-emscripten-core['"]/gmu;

function specifiersIn(text: string): readonly string[] {
  return [...text.matchAll(importSpecifier)].map(([, specifier = '']: readonly string[]) => specifier);
}

function isOwnFile(file: string, specifier: string): boolean {
  return /^\.{1,2}\//u.test(specifier) && !normalize(join(dirname(file), specifier)).startsWith('..');
}

function isAllowedImport(file: string, specifier: string): boolean {
  return (
    isOwnFile(file, specifier) ||
    importedEverywhere.has(specifier) ||
    [...importedInAFolder].some(
      ([folder, allowed]: readonly [string, readonly string[]]) =>
        file.startsWith(folder) && allowed.includes(specifier),
    )
  );
}

function importsOutsideTheAllowList(file: string, text: string): readonly string[] {
  return specifiersIn(text)
    .filter((specifier) => !isAllowedImport(file, specifier))
    .map((specifier) => `${file}: ${specifier}`);
}

function valueImportsOfQuickJsIn(file: string, text: string): readonly string[] {
  return [...text.matchAll(quickJsImport)]
    .filter(([, typeOnly]: readonly (string | undefined)[]) => typeOnly === undefined)
    .map(() => `${file}: ${quickJs}`);
}

const hostOnly: readonly Forbidden[] = [
  { what: 'a dynamic import', pattern: /\bimport\(/u },
  { what: 'a Node global', pattern: /\b(?:process|Buffer|require|setImmediate|__dirname)\b/u },
  { what: 'code generation', pattern: /\beval\(|new Function\(/u },
  { what: 'a host timer', pattern: /\bset(?:Timeout|Interval)\(/u },
];

const clockOrRandom: readonly Forbidden[] = [
  { what: 'the clock', pattern: /\bDate\.now\(|\bperformance\.now\(|\bTemporal\.Now\b/u },
  { what: 'a random source', pattern: /\bMath\.random\(|\bcrypto\.getRandomValues\(|\brandomUUID\(/u },
];

const impure: readonly Forbidden[] = [
  ...clockOrRandom,
  { what: 'a date of the host', pattern: /\bnew Date\b/u },
  { what: 'the host locale or time zone', pattern: /\bIntl\./u },
];

const growingCache: readonly Forbidden[] = [
  {
    what: 'a module-level collection',
    pattern: /^(?:export )?const \w+(?:: [^=]+)? = new (?:Map|Set)(?:<[^>]*>)?\(\);/mu,
  },
  { what: 'a module-level variable', pattern: /^(?:export )?let /mu },
  { what: 'a module-level list', pattern: /^(?:export )?const \w+(?:: [^=]+)? = \[\];/mu },
];

function isProductionSource(file: string): boolean {
  return file.endsWith('.ts') && !file.endsWith('.test.ts') && !/^(?:[\w-]+-)?testing\//u.test(file);
}

function sourcesUnder(folder: string): readonly string[] {
  return readdirSync(join(source, folder), { recursive: true, encoding: 'utf8' })
    .map((file) => join(folder, file))
    .filter((file) => isProductionSource(file));
}

function caught(text: string, forbidden: readonly Forbidden[]): readonly string[] {
  return forbidden.filter(({ pattern }: Forbidden) => pattern.test(text)).map(({ what }: Forbidden) => what);
}

function findingsIn(files: readonly string[], forbidden: readonly Forbidden[]): readonly string[] {
  return files.flatMap((file) =>
    caught(readFileSync(join(source, file), 'utf8'), forbidden).map((what) => `${file}: ${what}`),
  );
}

const expressionCall = /(?<!function )\brunExpression\(([^()]*)\)/gu;

function expressionCallsIn(text: string): readonly string[] {
  return [...text.matchAll(expressionCall)].map(([, call = '']: readonly string[]) =>
    call.replaceAll(/\s+/gu, ' ').trim(),
  );
}

function expressionCallsUnder(files: readonly string[]): readonly string[] {
  return files.flatMap((file) =>
    expressionCallsIn(readFileSync(join(source, file), 'utf8')).map((call) => `${file}: ${call}`),
  );
}

const everySource = sourcesUnder('.');

const nodeHostedEntries = ['dsl.ts', 'job-loop.ts', 'process-loop.ts'];

const nodeHosted = [...nodeHostedEntries, 'program-pool/', 'process-pool/', 'workers/', 'instances/'];

const portableSources = everySource.filter((file) => !nodeHosted.some((hosted) => file.startsWith(hosted)));

const machineAndRunLog = ['machine', 'runner', 'tasks', 'decider', 'run-log', 'dsl', 'programs'].flatMap((folder) =>
  sourcesUnder(folder),
);

function reachableFrom(entry: string): readonly string[] {
  return modulesReachedFrom(source, entry).files;
}

const nodeOrYaml: readonly Forbidden[] = [
  { what: 'a node: module', pattern: /from ['"]node:/u },
  { what: 'the YAML parser', pattern: /from ['"]yaml['"]/u },
];

describe('the testing entry', () => {
  it('reaches the memory adapter and the scripted pool, and takes no Node module and no YAML parser through any module it reaches', () => {
    const testingEntry = reachableFrom('testing/index.ts');

    expect(testingEntry).toEqual(expect.arrayContaining(['memory/memory-ports.ts', 'pool-testing/scripted-pool.ts']));
    expect(findingsIn(testingEntry, nodeOrYaml)).toEqual([]);
  });
});

describe('the entries of the engine', () => {
  it('reach the worker pool, the process pool and the instances of the sandbox only through the dsl and job-loop subpaths, and the process-loop subpath none of the modules of the worker pool, only those of the process pool and the ready signal, so the main, testing and worker entries stay portable', () => {
    expect(reachableFrom('dsl.ts')).toEqual(
      expect.arrayContaining([
        'program-pool/program-pool.ts',
        'instances/fresh-instances.ts',
        'instances/kept-instances.ts',
      ]),
    );
    expect(reachableFrom('job-loop.ts')).toEqual(
      expect.arrayContaining([
        'program-pool/job-loop.ts',
        'instances/instance-source.ts',
        'instances/instance-sources.ts',
      ]),
    );
    expect(reachableFrom('process-loop.ts').filter((file) => !/^process-|\/ready-signal/u.test(file))).toEqual([]);
    expect(reachableFrom('worker.ts')).toEqual(
      expect.arrayContaining(['jobs/program-answer.ts', 'programs/sandbox-session.ts']),
    );
    for (const entry of ['index.ts', 'testing/index.ts', 'worker.ts']) {
      expect(reachableFrom(entry).filter((file) => nodeHosted.some((hosted) => file.startsWith(hosted)))).toEqual([]);
    }
  });
});

describe('the engine core', () => {
  it('imports only effect, the workspace packages it builds on and its own files, the sandbox in the evaluator, the build of QuickJS in the instances alone, worker threads in the pool alone and child processes in the process pool alone', () => {
    expect(everySource.length).toBeGreaterThan(20);
    expect(
      everySource.flatMap((file) => importsOutsideTheAllowList(file, readFileSync(join(source, file), 'utf8'))),
    ).toEqual([]);
  });

  it('imports the QuickJS library by type alone wherever it is portable, so the host hands the evaluator its instances', () => {
    expect(
      portableSources.flatMap((file) => valueImportsOfQuickJsIn(file, readFileSync(join(source, file), 'utf8'))),
    ).toEqual([]);
    expect(
      sourcesUnder('programs').filter((file) => readFileSync(join(source, file), 'utf8').includes(quickJs)),
    ).toEqual(expect.arrayContaining(['programs/sandbox-session.ts', 'programs/sandbox-vm.ts']));
  });

  it('uses no Node global, no dynamic import, no code generation and no host timer, but for the timers of the worker pool', () => {
    expect(portableSources.length).toBeGreaterThan(20);
    expect(findingsIn(portableSources, hostOnly)).toEqual([]);
    expect(findingsIn(sourcesUnder('program-pool'), hostOnly).toSorted()).toEqual([
      'program-pool/evaluation-thread.ts: a host timer',
      'program-pool/pool-slots.ts: a host timer',
      'program-pool/pool-threads.ts: a host timer',
    ]);
    expect(sourcesUnder('workers').length).toBeGreaterThan(1);
    expect(findingsIn(sourcesUnder('workers'), hostOnly)).toEqual([]);
  });

  it('keeps no module-level cache that could grow with the history of a run: a collection built empty at module level is one; a constant collection of literals is not, nor a WeakMap, whose entries go with the values they describe', () => {
    expect(findingsIn(everySource, growingCache)).toEqual([]);
  });
});

describe('the machine, its runner, its tasks and its decider, the run log, the DSL and the evaluator', () => {
  it('read no clock, no random source and no locale, so the same state and input decide the same events', () => {
    expect(machineAndRunLog.length).toBeGreaterThan(50);
    expect(findingsIn(machineAndRunLog, impure)).toEqual([]);
  });

  it('give the sandbox a prelude that itself reads no clock, no random source and no locale, and builds no code', () => {
    expect(caught(preludeSource, [...impure, ...hostOnly])).toEqual([]);
    expect(caught(freezingPreludeSource, [...impure, ...hostOnly])).toEqual([]);
  });

  it('evaluate expressions under a budget of work and the deadline of the input, read on the clock the host gives the machine', () => {
    expect(expressionCallsUnder(everySource)).toEqual([
      'dsl/evaluation.ts: place.unit, source, { ...variables, data }, { now: place.now, mostWork, deadlineAt: place.deadlineAt },',
    ]);
    expect(readFileSync(join(source, 'runner/session.ts'), 'utf8')).toContain(
      'const deadlineAt = options.sandbox.clock() + mostInputMs;',
    );
  });
});

describe('the checks of imports', () => {
  it('catch what they are there to catch', () => {
    expect(
      importsOutsideTheAllowList(
        'machine/m.ts',
        "import { x } from 'fs';\nimport { y } from 'node:fs';\nimport type { W } from '@temporalio/workflow';\nimport variant from '@jitl/quickjs-wasmfile-release-sync';\nimport { Worker } from 'node:worker_threads';\nimport { Effect } from 'effect';\nimport { z } from '../dsl/z.ts';\nimport { w } from '../../../ledger/src/w.ts';\nimport 'yaml';",
      ),
    ).toEqual([
      'machine/m.ts: fs',
      'machine/m.ts: node:fs',
      'machine/m.ts: @temporalio/workflow',
      'machine/m.ts: @jitl/quickjs-wasmfile-release-sync',
      'machine/m.ts: node:worker_threads',
      'machine/m.ts: ../../../ledger/src/w.ts',
      'machine/m.ts: yaml',
    ]);
    expect(
      importsOutsideTheAllowList('programs/p.ts', "import variant from '@jitl/quickjs-wasmfile-release-sync';"),
    ).toEqual(['programs/p.ts: @jitl/quickjs-wasmfile-release-sync']);
    expect(
      importsOutsideTheAllowList('program-pool/p.ts', "import { W } from 'node:worker_threads';\nimport 'node:fs';"),
    ).toEqual(['program-pool/p.ts: node:fs']);
    expect(
      valueImportsOfQuickJsIn(
        'programs/p.ts',
        "import type { QuickJSHandle } from 'quickjs-emscripten-core';\nimport { newVariant } from 'quickjs-emscripten-core';",
      ),
    ).toEqual(['programs/p.ts: quickjs-emscripten-core']);
  });
});

describe('the checks of purity in the code', () => {
  it('catch what they are there to catch', () => {
    expect(caught("const y = await import('./z.ts');\nsetTimeout(f, 1);\nprocess.exit(1);", hostOnly)).toEqual([
      'a dynamic import',
      'a Node global',
      'a host timer',
    ]);
    expect(caught('const t = Date.now();\nconst r = Math.random();\nIntl.DateTimeFormat();', impure)).toEqual([
      'the clock',
      'a random source',
      'the host locale or time zone',
    ]);
    expect(caught('const now = Temporal.Now.instant();', clockOrRandom)).toEqual(['the clock']);
    expect(
      caught('const seen = new Map<string, number>();\nlet count = 0;\nconst all: string[] = [];', growingCache),
    ).toEqual(['a module-level collection', 'a module-level variable', 'a module-level list']);
    expect(
      caught("const kinds = new Set(['a', 'b']);\nconst sizes = new WeakMap<object, number>();", growingCache),
    ).toEqual([]);
    expect(
      expressionCallsIn(
        'function runExpression(source: string) {}\nrunExpression(unit, source, {}, { now, mostWork });',
      ),
    ).toEqual(['unit, source, {}, { now, mostWork }']);
  });
});
