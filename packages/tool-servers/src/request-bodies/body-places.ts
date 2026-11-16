import type { Schema } from 'effect';

import type { Encoding, MediaType } from '../openapi/api-document.ts';
import { isSchemaObject, translatedSchema, type SchemaObject } from '../openapi/schema-translation.ts';
import { placeSchemaOf, type FilePlace, type Place } from './file-places.ts';
import { essenceOf, isMediaRange } from './media-types.ts';
import { placeOf, resolvedSchema, typesOf, type BodyReading, type PlaceRead } from './part-places.ts';

export interface NamedPart {
  readonly name: string;
  readonly place: Place;
}

export interface OrderedParts {
  readonly kind: 'ordered_parts';
  readonly mediaType: string;
  readonly parts: readonly Place[];
  readonly after: Place | undefined;
  readonly least: number;
  readonly most: number | undefined;
}

export type SentBody =
  | { readonly kind: 'file'; readonly place: FilePlace }
  | { readonly kind: 'named_parts'; readonly mediaType: string; readonly parts: readonly NamedPart[] }
  | OrderedParts;

export interface OtherBody {
  readonly sent: SentBody;
  readonly schema: Schema.Json;
}

type Unsent = { readonly kind: 'unsent'; readonly because: string };

type OtherBodyRead = { readonly kind: 'other'; readonly body: OtherBody } | Unsent;

type PlacesRead<A> = { readonly kind: 'places'; readonly places: readonly A[] } | Unsent;

interface Order {
  readonly mediaType: string;
  readonly resolved: SchemaObject;
  readonly parts: readonly Place[];
  readonly after: Place | undefined;
}

type Content = readonly (readonly [string, MediaType])[];

const formData = 'multipart/form-data';

const urlEncodedForm = 'application/x-www-form-urlencoded';

function unsent(because: string): Unsent {
  return { kind: 'unsent', because };
}

function isJsonList(value: Schema.Json | undefined): value is readonly Schema.Json[] {
  return Array.isArray(value);
}

function placesOf<I, A>(
  items: readonly I[],
  read: (item: I) => PlaceRead,
  made: (item: I, place: Place) => A,
): PlacesRead<A> {
  const places: A[] = [];
  for (const item of items) {
    const each = read(item);
    if (each.kind === 'unsent') {
      return each;
    }
    places.push(made(item, each.place));
  }
  return { kind: 'places', places };
}

function describedBy(schema: SchemaObject): SchemaObject {
  const description = schema['description'];
  return typeof description === 'string' ? { description } : {};
}

function namedPlaceOf(media: MediaType, reading: BodyReading) {
  return ([name, written]: readonly [string, Schema.Json]): PlaceRead =>
    typesOf(resolvedSchema(written, reading.components)).includes('array')
      ? unsent(`its part ${name} is a list of parts, which a call does not send`)
      : placeOf(written, media.encoding?.[name], { part: name, ofAForm: true }, reading);
}

function formOf(resolved: SchemaObject, parts: readonly NamedPart[]): OtherBodyRead {
  const names = new Set(parts.map(({ name }) => name));
  const written = resolved['required'];
  const required = isJsonList(written) ? written.filter((name) => typeof name === 'string' && names.has(name)) : [];
  return {
    kind: 'other',
    body: {
      sent: { kind: 'named_parts', mediaType: formData, parts },
      schema: {
        type: 'object',
        ...describedBy(resolved),
        properties: Object.fromEntries(parts.map(({ name, place }) => [name, placeSchemaOf(place)])),
        ...(required.length === 0 ? {} : { required }),
        additionalProperties: false,
      },
    },
  };
}

function describesByPosition(media: MediaType): boolean {
  return media.prefixEncoding !== undefined || media.itemEncoding !== undefined || media.itemSchema !== undefined;
}

function namedPartsOf(media: MediaType, reading: BodyReading): OtherBodyRead {
  if (describesByPosition(media)) {
    return unsent(
      `its body is ${formData}, whose parts the document describes by position, which a call does not send`,
    );
  }
  const resolved = resolvedSchema(media.schema, reading.components);
  const properties = resolved?.['properties'];
  if (resolved === undefined || !isSchemaObject(properties)) {
    return unsent(`its body is ${formData}, and the document does not say what each of its parts is`);
  }
  const read = placesOf(
    Object.entries(properties),
    namedPlaceOf(media, reading),
    ([name]: readonly [string, Schema.Json], place: Place): NamedPart => ({ name, place }),
  );
  return read.kind === 'unsent' ? read : formOf(resolved, read.places);
}

function countOf(resolved: SchemaObject, keyword: string): number | undefined {
  const count = resolved[keyword];
  return typeof count === 'number' ? count : undefined;
}

function orderOf({ mediaType, resolved, parts, after }: Order): OtherBodyRead {
  const least = countOf(resolved, 'minItems');
  const most = countOf(resolved, 'maxItems');
  const room = after === undefined ? Math.min(most ?? parts.length, parts.length) : most;
  if (least !== undefined && room !== undefined && least > room) {
    return unsent(
      `its body is ${mediaType}, and its document asks for at least ${least} parts where it takes at most ${room}`,
    );
  }
  return {
    kind: 'other',
    body: {
      sent: { kind: 'ordered_parts', mediaType, parts, after, least: least ?? 0, most },
      schema: {
        type: 'array',
        ...describedBy(resolved),
        prefixItems: parts.map((place) => placeSchemaOf(place)),
        ...(least === undefined ? {} : { minItems: least }),
        ...(most === undefined ? {} : { maxItems: most }),
        items: after === undefined ? false : placeSchemaOf(after),
      },
    },
  };
}

function afterOf(resolved: SchemaObject, positions: number, reading: BodyReading): PlaceRead | undefined {
  const items = resolved['items'];
  return items === false
    ? undefined
    : placeOf(isSchemaObject(items) ? items : {}, undefined, { part: `after ${positions}`, ofAForm: false }, reading);
}

function orderedPlacesOf(
  items: readonly Schema.Json[],
  prefixEncoding: readonly Encoding[],
  reading: BodyReading,
): PlacesRead<Place> {
  return placesOf(
    Array.from({ length: Math.max(items.length, prefixEncoding.length) }, (_, index) => index),
    (index: number) =>
      placeOf(items[index], prefixEncoding[index], { part: String(index + 1), ofAForm: false }, reading),
    (_: number, place: Place) => place,
  );
}

function orderIn(mediaType: string, resolved: SchemaObject, read: PlacesRead<Place>, after: PlaceRead | undefined) {
  if (read.kind === 'unsent') {
    return read;
  }
  return after?.kind === 'unsent' ? after : orderOf({ mediaType, resolved, parts: read.places, after: after?.place });
}

function isEncodedPastThePositions({ itemEncoding, itemSchema }: MediaType): boolean {
  return itemEncoding !== undefined || itemSchema !== undefined;
}

function orderedPartsOf(mediaType: string, media: MediaType, reading: BodyReading): OtherBodyRead {
  const unsaid = unsent(`its body is ${mediaType}, and the document does not say what each of its parts is`);
  const { prefixEncoding } = media;
  if (reading.version !== '3.2' || prefixEncoding === undefined) {
    return unsaid;
  }
  if (isEncodedPastThePositions(media)) {
    return unsent(
      `its body is ${mediaType}, whose parts the document describes by itemEncoding or itemSchema, which a call does not send`,
    );
  }
  const resolved = resolvedSchema(media.schema, reading.components);
  const items = resolved?.['prefixItems'] ?? [];
  if (resolved === undefined || !isJsonList(items)) {
    return unsaid;
  }
  const read = orderedPlacesOf(items, prefixEncoding, reading);
  return orderIn(mediaType, resolved, read, afterOf(resolved, Math.max(items.length, prefixEncoding.length), reading));
}

function fileBodyOf(entries: Content, reading: BodyReading): OtherBodyRead {
  const declared = entries.map(([mediaType]) => mediaType.trim());
  const unread = declared.find((range) => !isMediaRange(range));
  if (unread !== undefined) {
    return unsent(`its body is ${unread}, which is not a media type`);
  }
  const [only] = entries;
  const written = entries.length === 1 && only !== undefined ? only[1].schema : undefined;
  const place: FilePlace = { kind: 'file', declared, schema: translatedSchema(written ?? {}, reading.version) };
  return { kind: 'other', body: { sent: { kind: 'file', place }, schema: placeSchemaOf(place) } };
}

function isBodyOfParts([mediaType]: readonly [string, MediaType]): boolean {
  const essence = essenceOf(mediaType);
  return essence === urlEncodedForm || essence.startsWith('multipart/');
}

function partsBodyOf(mediaType: string, media: MediaType, reading: BodyReading): OtherBodyRead {
  const essence = essenceOf(mediaType);
  if (essence === urlEncodedForm) {
    return unsent(`its body is ${urlEncodedForm}, a form a call does not send`);
  }
  return essence === formData ? namedPartsOf(media, reading) : orderedPartsOf(essence, media, reading);
}

export function otherBodyOf(entries: Content, reading: BodyReading): OtherBodyRead {
  const parted = entries.find((entry) => isBodyOfParts(entry));
  if (parted === undefined) {
    return fileBodyOf(entries, reading);
  }
  if (entries.length > 1) {
    const listed = entries.map(([mediaType]) => mediaType).join(', ');
    return unsent(`its body may be ${listed}, and the document does not say which of them a call sends`);
  }
  return partsBodyOf(parted[0], parted[1], reading);
}
