import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PayloadOffloading, PayloadSizeThreshold } from '@on.auto/operations/payloads';
import { HeldValueSizeThreshold } from '@on.auto/workflow-host';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import { defaultPayloadSettings, type PayloadSettings } from '../settings/content-settings.ts';
import { payloadOffloadingOf } from './process-layers.ts';

const runtimeFolder = fileURLToPath(new URL('../../../../', import.meta.url));

const composedHere = 'packages/server/src/composition/process-layers.ts';

const provision =
  /(?:provide\w*|Layer\.\w+|Context\.(?:add|make))\([^;]*?\b(?:PayloadOffloading|PayloadSizeThreshold|HeldValueSizeThreshold)\b/u;

function isComposed(path: string): boolean {
  return path.endsWith('.ts') && !path.endsWith('.test.ts') && !/testing/u.test(path);
}

function sourcesUnder(folder: string, recursive: boolean): readonly string[] {
  return existsSync(folder)
    ? readdirSync(folder, { recursive, encoding: 'utf8' })
        .filter((path) => isComposed(path))
        .map((path) => join(folder, path))
    : [];
}

function provisionsIn(folders: readonly string[]): readonly string[] {
  return folders
    .flatMap((folder) => [...sourcesUnder(folder, false), ...sourcesUnder(join(folder, 'src'), true)])
    .filter((path) => provision.test(readFileSync(path, 'utf8')))
    .map((path) => path.slice(runtimeFolder.length));
}

const keeping = Effect.gen(function* () {
  return {
    offloading: yield* PayloadOffloading,
    facts: yield* PayloadSizeThreshold,
    heldValues: yield* HeldValueSizeThreshold,
  };
});

async function keepingIn(layer: Layer.Layer<never>): Promise<Effect.Success<typeof keeping>> {
  const runtime = ManagedRuntime.make(layer);
  const kept = await runtime.runPromise(keeping);
  await runtime.dispose();
  return kept;
}

function composedWith(settings: PayloadSettings): Promise<Effect.Success<typeof keeping>> {
  return keepingIn(payloadOffloadingOf(settings));
}

describe('the payloads of facts and of the values workflows hold, in the server', () => {
  it('are offloaded past the threshold its settings give, one number for both, and on past 16384 bytes by default', async () => {
    expect([
      await composedWith(defaultPayloadSettings),
      await composedWith({ offloading: false, sizeThresholdBytes: 4096 }),
    ]).toEqual([
      { offloading: true, facts: 16_384, heldValues: 16_384 },
      { offloading: false, facts: 4096, heldValues: 4096 },
    ]);
  });

  it('are kept as the core keeps them where nothing composes the settings, as Auto’s cloud composes it', async () => {
    expect([await keepingIn(payloadOffloadingOf(defaultPayloadSettings)), await keepingIn(Layer.empty)]).toEqual([
      { offloading: true, facts: 16_384, heldValues: 16_384 },
      { offloading: false, facts: 16_384, heldValues: 16_384 },
    ]);
  });

  it('are offloaded by no source of the server, its packages or its capabilities but the composition of its settings', () => {
    const folders = ['packages', 'capabilities'].flatMap((group) =>
      readdirSync(join(runtimeFolder, group)).map((name) => join(runtimeFolder, group, name)),
    );

    expect(provisionsIn(folders)).toEqual([composedHere]);
  });

  it('would find a source that provides the switch or a threshold, by a layer, a service provided or a context', () => {
    const turningOn = [
      'Layer.succeed(PayloadOffloading, true)',
      'Effect.provideService(PayloadOffloading, true)',
      'Effect.provideService(work, PayloadSizeThreshold, 4096)',
      'Context.add(HeldValueSizeThreshold, 4096)',
      'Context.make(\n  PayloadOffloading,\n  true,\n)',
    ];

    expect(turningOn.filter((source) => !provision.test(source))).toEqual([]);
    expect(provision.test('const outside = yield* PayloadOffloading;')).toBe(false);
  });
});
