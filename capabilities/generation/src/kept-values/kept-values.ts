import { Buffer } from 'node:buffer';

import { textToKeep } from '@on.auto/content';
import {
  Conflict,
  PlaybookContext,
  PlaybookReader,
  PlaybookWriter,
  runStreamNameOf,
  uuidV5,
  type AssetReference,
  type ValueKeeping,
} from '@on.auto/operations';
import { sizeInWords } from '@on.auto/phrasing';
import { Clock, Effect } from 'effect';

import { assetDecider, type AssetCommand } from '../assets/asset-decider.ts';
import { assetStreamOf, expiryOf, type AssetKeptDataWritten } from '../assets/asset-facts.ts';
import { assetRowFrom, assetsName, rowKeyed } from '../assets/asset-projections.ts';
import { generationBounds, type GenerationBounds } from '../capability/generation-ports.ts';
import { roomLeft, type TotalsReading } from '../run/asset-room.ts';

type RunOfAKeptValue = Parameters<ValueKeeping['kept']>[0];

type ValueToKeep = Parameters<ValueKeeping['kept']>[1];

const keptValues = '8e1f6a2c-3b7d-4c95-a0e4-6d2b9f7c1a53';

type KeptValueBounds = Pick<GenerationBounds, 'mostFileBytes' | 'mostPlaybookBytes' | 'keptMs'>;

export function assetIdOfAValue(runId: string, pointer: string, sha256: string): string {
  return uuidV5(keptValues, JSON.stringify([runId, pointer, sha256]));
}

function largerThanAFile({ pointer }: ValueToKeep, bytes: number, most: number): Conflict {
  const what = pointer === '' ? 'The output takes' : `The output's value at ${pointer} takes`;
  return new Conflict({
    detail: `${what} ${sizeInWords(bytes)}, more than the ${sizeInWords(most)} the runtime keeps of a file, so none of it was kept; return less, or give each run a part of the input`,
    kind: 'oversized',
  });
}

function totalsIn(reader: PlaybookReader['Service']): TotalsReading {
  return { readProjectedRows: (projection, _playbook, query) => reader.readProjectedRows(projection, query) };
}

function referenceOf(id: string, kept: Pick<AssetKeptDataWritten, 'media_type' | 'bytes' | 'sha256'>): AssetReference {
  return {
    id,
    media_type: kept.media_type,
    bytes: kept.bytes,
    sha256: kept.sha256,
    address: null,
    address_until: null,
  };
}

function wasKeptBefore({ kind }: Readonly<{ kind?: string | undefined }>): boolean {
  return kind === 'concurrent_change';
}

function keptBefore(reader: PlaybookReader['Service'], id: string): Effect.Effect<AssetReference> {
  return Effect.map(reader.readProjectedRows(assetsName, rowKeyed(id)), ([found]) =>
    referenceOf(id, assetRowFrom(found?.row)),
  );
}

/** The definition whose run keeps the value, under whose key its asset is filed, as every asset a run keeps is. */
function definitionOfTheRun(reader: PlaybookReader['Service'], runId: string): Effect.Effect<string> {
  return Effect.flatMap(reader.definitionHolding(runStreamNameOf(runId)), (definition) =>
    definition === undefined
      ? Effect.die(new Error(`The run ${runId} that keeps a value is not a run of this playbook`))
      : Effect.succeed(definition),
  );
}

function keptValue(bounds: KeptValueBounds, run: RunOfAKeptValue, value: ValueToKeep) {
  return Effect.gen(function* () {
    const bytes = Buffer.byteLength(value.text, 'utf8');
    if (bytes > bounds.mostFileBytes) {
      return yield* Effect.fail(largerThanAFile(value, bytes, bounds.mostFileBytes));
    }
    const playbook = yield* PlaybookContext;
    const reader = yield* PlaybookReader;
    const writer = yield* PlaybookWriter;
    yield* roomLeft(totalsIn(reader), playbook, bounds.mostPlaybookBytes);
    const definition = yield* definitionOfTheRun(reader, run.context.runId);
    const held = yield* Effect.orDie(writer.keepContent(textToKeep(value.text, value.mediaType)));
    const id = assetIdOfAValue(run.context.runId, value.pointer, held.sha256);
    const at = yield* Clock.currentTimeMillis;
    const data: AssetKeptDataWritten = {
      media_type: value.mediaType,
      bytes: held.bytes,
      sha256: held.sha256,
      kind: 'text',
      made_by: { function_output: { pointer: value.pointer } },
      ...expiryOf(at, bounds.keptMs),
    };
    const command: AssetCommand = {
      event: { type: 'asset_kept', data },
      context: { ...run.context, at: new Date(at).toISOString() },
    };
    return yield* writer
      .ofDefinition(definition)
      .execute(assetStreamOf(id), assetDecider, command, run.lineage)
      .pipe(
        Effect.as(referenceOf(id, data)),
        Effect.catchIf(wasKeptBefore, () => keptBefore(reader, id)),
      );
  });
}

export function valuesKeptAsAssets(bounds: KeptValueBounds = generationBounds): ValueKeeping {
  return { kept: (run, value) => keptValue(bounds, run, value) };
}
