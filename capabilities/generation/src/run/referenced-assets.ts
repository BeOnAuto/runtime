import { Buffer } from 'node:buffer';

import type { ContentOwner, RecordedContent } from '@on.auto/content';
import { InvalidInput, type ProjectionReader } from '@on.auto/operations';
import { alternatives } from '@on.auto/phrasing';
import { Effect, JsonPointer, Predicate, Result, type Schema } from 'effect';

import { assetRowOf, assetsName, hasExpired, rowKeyed, type AssetRow } from '../assets/asset-projections.ts';
import { sizeInWords } from '../assets/asset-words.ts';
import { referenceLimitsOf, type CatalogEntry } from '../catalog/catalog-entry.ts';
import type { ReferenceContent } from '../gateway/generation-gateway.ts';

export interface ReferencedAsset extends ReferenceContent {
  readonly id: string;
  readonly sha256: string;
}

export interface ReferenceReading {
  readonly ledger: Pick<ProjectionReader, 'readProjectedRows'>;
  readonly content: Pick<RecordedContent, 'get'>;
}

interface Referring {
  readonly playbook: ContentOwner;
  readonly entry: CatalogEntry;
  readonly now: number;
}

function refused(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({
    detail: `A reference of the input cannot be used: ${detail}`,
    issues: [{ pointer, detail }],
  });
}

function isJsonObject(value: Schema.Json | undefined): value is Schema.JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function isList(value: Schema.Json | undefined): value is readonly Schema.Json[] {
  return Array.isArray(value);
}

function childOf(value: Schema.Json | undefined, token: string): Schema.Json | undefined {
  if (isList(value)) {
    return /^(?:0|[1-9]\d*)$/u.test(token) ? value[Number(token)] : undefined;
  }
  return isJsonObject(value) && Object.hasOwn(value, token) ? value[token] : undefined;
}

function valueAt(input: Schema.Json, pointer: string): Schema.Json | undefined {
  return pointer
    .split('/')
    .slice(1)
    .reduce<Schema.Json | undefined>((value, token) => childOf(value, JsonPointer.unescapeToken(token)), input);
}

function idAt(input: Schema.JsonObject, pointer: string): Effect.Effect<string, InvalidInput> {
  const value = valueAt(input, pointer);
  return typeof value === 'string'
    ? Effect.succeed(value)
    : Effect.fail(refused(pointer, 'Expected the id of an asset of this playbook'));
}

function rowOf(reading: ReferenceReading, playbook: ContentOwner, id: string): Effect.Effect<AssetRow | undefined> {
  return Effect.map(reading.ledger.readProjectedRows(assetsName, playbook, rowKeyed(id)), ([kept]) =>
    assetRowOf(kept?.row),
  );
}

function problemOf(row: AssetRow, id: string, { entry, now }: Referring): string | undefined {
  if (hasExpired(row, now)) {
    return `The asset ${id} has expired`;
  }
  const limits = referenceLimitsOf(entry);
  if (!entry.media_types.includes(row.media_type)) {
    return `The asset ${id} is ${row.media_type}, which ${entry.model} does not take; it takes ${alternatives(entry.media_types)}`;
  }
  return limits !== undefined && row.bytes > limits.bytes
    ? `The asset ${id} takes ${sizeInWords(row.bytes)}, more than the ${sizeInWords(limits.bytes)} ${entry.model} takes of one reference`
    : undefined;
}

function usableRow(row: AssetRow | undefined, id: string, referring: Referring): Result.Result<AssetRow, string> {
  if (row === undefined) {
    return Result.fail(`No asset of this playbook has the id ${id}`);
  }
  const problem = problemOf(row, id, referring);
  return problem === undefined ? Result.succeed(row) : Result.fail(problem);
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Readonly<Uint8Array<ArrayBuffer>>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function referencedAt(
  reading: ReferenceReading,
  input: Schema.JsonObject,
  pointer: string,
  referring: Referring,
): Effect.Effect<ReferencedAsset, InvalidInput> {
  return Effect.gen(function* () {
    const id = yield* idAt(input, pointer);
    const usable = usableRow(yield* rowOf(reading, referring.playbook, id), id, referring);
    if (Result.isFailure(usable)) {
      return yield* Effect.fail(refused(pointer, usable.failure));
    }
    const row = usable.success;
    const content = yield* reading.content.get(referring.playbook, row.sha256);
    if (content === undefined) {
      return yield* Effect.fail(refused(pointer, `The content of the asset ${id} is no longer kept`));
    }
    const bytes = yield* Effect.promise(() => bytesOf(content.stream));
    return { id, sha256: row.sha256, mediaType: row.media_type, bytes };
  });
}

export function referencedAssets(
  reading: ReferenceReading,
  input: Schema.JsonObject,
  pointers: readonly string[],
  referring: Referring,
): Effect.Effect<readonly ReferencedAsset[], InvalidInput> {
  return Effect.forEach(pointers, (pointer) => referencedAt(reading, input, pointer, referring));
}
