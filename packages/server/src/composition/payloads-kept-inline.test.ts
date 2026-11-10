import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { PayloadsOutside } from '@on.auto/operations/payloads';
import { Effect, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import { applicationLayer } from './application-layer.ts';

const runtimeFolder = fileURLToPath(new URL('../../../../', import.meta.url));

const provision = /(?:provide\w*|Layer\.\w+|Context\.(?:add|make))\([^;]*?\bPayloadsOutside\b/u;

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

const keptOutside = Effect.gen(function* () {
  return yield* PayloadsOutside;
});

describe('the payloads of facts, in the server', () => {
  it('stay inline: the runtime the server composes keeps none outside', async () => {
    const runtime = ManagedRuntime.make(applicationLayer(ledgerLayer({ fileName: ':memory:' })));

    const outside = await runtime.runPromise(keptOutside);
    await runtime.dispose();

    expect(outside).toBe(false);
  });

  it('stay inline: no source of the server, its packages or its capabilities turns on keeping them outside', () => {
    const folders = ['packages', 'capabilities'].flatMap((group) =>
      readdirSync(join(runtimeFolder, group)).map((name) => join(runtimeFolder, group, name)),
    );

    expect(provisionsIn(folders)).toEqual([]);
  });

  it('would find a source that turns it on, by a layer, a service provided or a context', () => {
    const turningOn = [
      'Layer.succeed(PayloadsOutside, true)',
      'Effect.provideService(PayloadsOutside, true)',
      'Effect.provideService(work, PayloadsOutside, true)',
      'Context.add(PayloadsOutside, true)',
      'Context.make(\n  PayloadsOutside,\n  true,\n)',
    ];

    expect(turningOn.filter((source) => !provision.test(source))).toEqual([]);
    expect(provision.test('const outside = yield* PayloadsOutside;')).toBe(false);
  });
});
