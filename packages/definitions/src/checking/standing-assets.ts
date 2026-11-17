import type { CompiledSchema } from '@on.auto/json-schema';
import { assetContentOf, assetsIn, type AssetContent, type Issue } from '@on.auto/operations';
import { JsonPointer, type Schema } from 'effect';

import { placeAt, typesOf } from '../schema-words/schema-reading.ts';

const typesStoodFor: Readonly<Record<AssetContent, readonly string[]>> = {
  text: ['string'],
  json: ['object', 'array', 'string'],
  file: [],
};

function tokensOf(pointer: string): readonly string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
}

function standsAt(schema: CompiledSchema, pointer: string, mediaType: unknown): boolean {
  const stoodFor = typeof mediaType === 'string' ? typesStoodFor[assetContentOf(mediaType)] : [];
  const declared = placeAt(schema.document, tokensOf(pointer)).schemas.flatMap((each) => typesOf(each));
  return stoodFor.length > 0 && (declared.length === 0 || declared.some((type) => stoodFor.includes(type)));
}

function isAtOrWithin(pointer: string, place: string): boolean {
  return pointer === place || pointer.startsWith(`${place}/`);
}

export function besideStandingAssets(
  schema: CompiledSchema,
  input: Schema.Json,
  issues: readonly Issue[],
): readonly Issue[] {
  const standing = assetsIn(input)
    .filter(({ pointer, shaped }) => standsAt(schema, pointer, shaped['media_type']))
    .map(({ pointer }) => pointer);
  return issues.filter(({ pointer }) => !standing.some((place) => isAtOrWithin(pointer, place)));
}
