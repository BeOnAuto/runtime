import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { modelProcessModule } from '@on.auto/prediction';
import { testPorts } from '@on.auto/prediction/testing';
import type { ModuleAddress } from '@on.auto/workflow-engine/dsl';
import { Effect, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { candidatePath, scratchFolder } from '../candidates-testing/onnx-candidates.ts';
import { onnxRuntime } from '../runtime/onnx-runtime.ts';

const packagesAModelProcessLoads: readonly string[] = [
  '@on.auto/prediction',
  '@on.auto/prediction-contract',
  '@on.auto/prediction-onnx',
  '@on.auto/workflow-engine',
  'effect',
  'onnxruntime-common',
  'onnxruntime-node',
];

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ name: Schema.String })));

const loadedFile = 'loaded';

const fed = { features: 0, given: 0, horizon: 2, totals: false };

interface WatchedProcess {
  readonly module: ModuleAddress;
  readonly loaded: string;
}

function watchedModelProcess(): WatchedProcess {
  const directory = scratchFolder();
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
  const path = join(scratchFolder(), 'scoring.csv');
  writeFileSync(path, ['series,period,visits', 'north,2026-10-01,10', 'north,2026-10-02,12'].join('\r\n'));
  return path;
}

const mean = { sha256: 'visits-mean', path: candidatePath('visits-mean') };

describe('a model process that runs the models of onnxruntime', () => {
  it('checks a candidate, answers a question and walks the held-back origins in the process that holds the model', async () => {
    const { models } = testPorts({ runtimes: [onnxRuntime], processes: 3 }).ports;
    const question = { y: Float32Array.of(10, 12), x: null, given: null, h: null, at: null, features: 0, givens: 0 };
    const walk = {
      rows: rowsFile(),
      window: 2,
      holdout: 1,
      steps: 2,
      features: 0,
      given: [],
      remaining: null,
      first: null,
    };

    expect(await Effect.runPromise(models.check(onnxRuntime, mean, fed))).toMatchObject({
      ended: 'answered',
      answer: { loaded: true, signature: { opset: 13 }, issue: null },
    });
    expect(await Effect.runPromise(models.run(onnxRuntime, mean, question))).toMatchObject({
      ended: 'answered',
      answer: { q: Float32Array.of(9, 11, 13, 9, 11, 13), dims: [1, 2, 3] },
    });
    expect(await Effect.runPromise(models.walk(onnxRuntime, mean, walk))).toMatchObject({
      ended: 'answered',
      answer: { series: ['north'], q: [Float32Array.of(9, 11, 13, 9, 11, 13)] },
    });
  });

  it('loads no package beyond the capability, this one, the engine’s process loop, Effect and onnxruntime, through the check of a candidate', async () => {
    const watched = watchedModelProcess();
    const { models } = testPorts({ runtimes: [onnxRuntime], module: watched.module, processes: 2 }).ports;
    const checked = await Effect.runPromise(models.check(onnxRuntime, mean, fed));

    expect(checked).toMatchObject({ ended: 'answered', answer: { loaded: true } });
    expect(packagesIn(watched)).toEqual(packagesAModelProcessLoads);
  });
});
