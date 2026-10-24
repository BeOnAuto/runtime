import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import type { ModuleAddress } from '@on.auto/workflow-engine/dsl';
import { Effect, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { modelProcesses, modelProcessModule, type ModelProcesses } from '../model-processes/model-processes.ts';
import { closedAfterTheTest, scratchDirectory } from '../testing/scratch.ts';

const packagesAModelProcessLoads: readonly string[] = [
  '@on.auto/prediction',
  '@on.auto/workflow-engine',
  'effect',
  'onnxruntime-common',
  'onnxruntime-node',
];

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ name: Schema.String })));

const loadedFile = 'loaded';

interface WatchedProcess {
  readonly module: ModuleAddress;
  readonly loaded: string;
}

function watchedModelProcess(): WatchedProcess {
  const directory = scratchDirectory();
  const loaded = join(directory, loadedFile);
  const module = pathToFileURL(join(directory, 'watched-model-process.mjs'));
  writeFileSync(loaded, '');
  writeFileSync(
    module,
    [
      "import { appendFileSync } from 'node:fs';",
      "import { registerHooks } from 'node:module';",
      `const loaded = new URL('./${loadedFile}', import.meta.url);`,
      'registerHooks({',
      '  load: (url, context, nextLoad) => {',
      "    appendFileSync(loaded, url + '\\n');",
      '    return nextLoad(url, context);',
      '  },',
      '});',
      `await import('${modelProcessModule().href}');`,
    ].join('\n'),
  );
  return { module: () => module, loaded };
}

function packageOf(directory: string): string {
  const manifest = join(directory, 'package.json');
  const named = existsSync(manifest) ? decodeManifest(readFileSync(manifest, 'utf8')) : Option.none();
  return Option.isSome(named) ? named.value.name : packageOf(dirname(directory));
}

function packagesIn({ loaded }: WatchedProcess): readonly string[] {
  const files = readFileSync(loaded, 'utf8')
    .split('\n')
    .filter((url) => url.startsWith('file:'));
  return [...new Set(files.map((url) => packageOf(dirname(fileURLToPath(url)))))].toSorted();
}

function rowsFile(): string {
  const path = join(scratchDirectory(), 'rows.csv');
  const days = Array.from({ length: 12 }, (_, day) => `north,2026-10-${String(day + 1).padStart(2, '0')},${day % 3}`);
  writeFileSync(path, ['series,period,visits', ...days].join('\r\n'));
  return path;
}

const baselinesJob: Parameters<ModelProcesses['baselines']>[1] = {
  period: 'day',
  horizons: [1],
  accumulates: null,
  season: null,
  window: 12,
  holdout: 4,
  firstPeriod: '2026-10-01',
  baselines: ['persistence'],
  metric: 'mase',
};

describe('the module a model process runs', () => {
  it('says it is ready to its server, and ends of itself when its server lets it go', async () => {
    const child = spawnForTheTest(process.execPath, [...process.execArgv, fileURLToPath(modelProcessModule())], {
      serialization: 'json',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const heard: readonly unknown[] = await once(child, 'message');
    const ended = once(child, 'exit');
    child.disconnect();

    expect([heard[0], await ended]).toEqual([{ ready: true }, [0, null]]);
  });

  it('loads no package beyond its own, the engine’s process loop, Effect and the model runtime, through the check of a build’s baselines', async () => {
    const watched = watchedModelProcess();
    const models = modelProcesses({ pool: closedAfterTheTest(1, 1), module: watched.module });
    const checked = await Effect.runPromise(models.baselines({ sha256: 'rows', path: rowsFile() }, baselinesJob));

    expect(checked).toMatchObject({ ended: 'answered', answer: { perfect: null, unscorable: false } });
    expect(packagesIn(watched)).toEqual(packagesAModelProcessLoads);
  });
});
