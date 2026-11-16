import { JsonPointer, Predicate, type Schema } from 'effect';

import type { Encoding, OpenApiVersion } from '../openapi/api-document.ts';
import { isSchemaObject, translatedSchema, type SchemaObject } from '../openapi/schema-translation.ts';
import type { Place } from './file-places.ts';
import { essenceOf, isJsonType, isMediaRange, plainText, rangesIn } from './media-types.ts';

export interface BodyReading {
  readonly version: OpenApiVersion;
  readonly components: Readonly<Record<string, Schema.Json>>;
}

export type PlaceRead =
  | { readonly kind: 'place'; readonly place: Place }
  | { readonly kind: 'unsent'; readonly because: string };

interface PartOfABody {
  readonly part: string;
  readonly ofAForm: boolean;
}

const mostReferenceHops = 8;

const componentReference = '#/components/schemas/';

const octetStream = 'application/octet-stream';

const jsonText = 'application/json';

const defaultTypes: ReadonlyMap<string, string> = new Map([
  ['string', 'text/plain'],
  ['number', 'text/plain'],
  ['integer', 'text/plain'],
  ['boolean', 'text/plain'],
  ['object', jsonText],
  ['array', jsonText],
]);

function unsentPart(because: string): PlaceRead {
  return { kind: 'unsent', because };
}

function componentAt(reference: string, components: BodyReading['components']): Schema.Json | undefined {
  if (!reference.startsWith(componentReference)) {
    return undefined;
  }
  const name = JsonPointer.unescapeToken(reference.slice(componentReference.length));
  return Object.hasOwn(components, name) ? components[name] : undefined;
}

export function resolvedSchema(
  schema: Schema.Json | undefined,
  components: BodyReading['components'],
): SchemaObject | undefined {
  let current = schema;
  for (let hops = 0; hops <= mostReferenceHops && isSchemaObject(current); hops += 1) {
    const reference = current['$ref'];
    if (typeof reference !== 'string') {
      return current;
    }
    current = componentAt(reference, components);
  }
  return undefined;
}

export function typesOf(schema: SchemaObject | undefined): readonly unknown[] {
  const type = schema?.['type'];
  if (typeof type === 'string') {
    return [type];
  }
  return Array.isArray(type) ? type : [];
}

function isBinaryIn30(schema: SchemaObject | undefined, version: OpenApiVersion): boolean {
  return version === '3.0' && schema?.['format'] === 'binary';
}

function defaultOfType(type: unknown): readonly string[] {
  const found = typeof type === 'string' ? defaultTypes.get(type) : undefined;
  return found === undefined ? [] : [found];
}

function defaultTypesOf(schema: SchemaObject | undefined, version: OpenApiVersion): readonly string[] {
  const defaults = new Set(typesOf(schema).flatMap((type) => defaultOfType(type)));
  if (defaults.size === 0 || isBinaryIn30(schema, version)) {
    return [octetStream];
  }
  return defaults.size === 1 ? [...defaults] : [];
}

function isRequiredHeader([name, header]: readonly [string, unknown]): boolean {
  if (name.toLowerCase() === 'content-type') {
    return false;
  }
  return (
    Predicate.hasProperty(header, '$ref') || (Predicate.hasProperty(header, 'required') && header.required === true)
  );
}

function isBodyOfParts({ encoding, prefixEncoding, itemEncoding }: Encoding): boolean {
  return encoding !== undefined || prefixEncoding !== undefined || itemEncoding !== undefined;
}

function isStyled({ style, explode, allowReserved }: Encoding): boolean {
  return style !== undefined || explode !== undefined || allowReserved !== undefined;
}

function headerBecause({ headers = {} }: Encoding, part: string): string | undefined {
  const [header] = Object.entries(headers).find((entry: readonly [string, unknown]) => isRequiredHeader(entry)) ?? [];
  return header === undefined ? undefined : `its part ${part} needs the header ${header}, which a call does not send`;
}

function encodingBecause(encoding: Encoding | undefined, { part, ofAForm }: PartOfABody): string | undefined {
  if (encoding === undefined) {
    return undefined;
  }
  if (isBodyOfParts(encoding)) {
    return `its part ${part} is itself a body of parts, which a call does not send`;
  }
  return ofAForm && isStyled(encoding)
    ? `its part ${part} is written with style, explode or allowReserved, a form a call does not send`
    : headerBecause(encoding, part);
}

function declaredOf(encoding: Encoding | undefined, schema: SchemaObject | undefined, reading: BodyReading) {
  const written = encoding?.contentType;
  return written === undefined ? defaultTypesOf(schema, reading.version) : rangesIn(written);
}

interface Declared {
  readonly written: Schema.Json | undefined;
  readonly resolved: SchemaObject | undefined;
  readonly encoding: Encoding | undefined;
  readonly declared: readonly string[];
}

function isAFieldOfAForm({ resolved, encoding, declared }: Declared): boolean {
  const [only] = declared;
  return (
    encoding?.contentType === undefined &&
    resolved?.['contentMediaType'] === undefined &&
    declared.length === 1 &&
    only === plainText
  );
}

function placeIn(read: Declared, { part, ofAForm }: PartOfABody, reading: BodyReading): PlaceRead {
  const { written, declared } = read;
  const schema = translatedSchema(written ?? {}, reading.version);
  const [first = jsonText] = declared;
  if (declared.every((range) => isJsonType(range))) {
    return { kind: 'place', place: { kind: 'json', mediaType: essenceOf(first), schema } };
  }
  if (!ofAForm) {
    return { kind: 'place', place: { kind: 'file', declared, schema } };
  }
  return isAFieldOfAForm(read)
    ? { kind: 'place', place: { kind: 'field', schema } }
    : unsentPart(`its part ${part} is a file, which a form sends with a file name, and a call cannot give one`);
}

export function placeOf(
  written: Schema.Json | undefined,
  encoding: Encoding | undefined,
  partOf: PartOfABody,
  reading: BodyReading,
): PlaceRead {
  const because = encodingBecause(encoding, partOf);
  if (because !== undefined) {
    return unsentPart(because);
  }
  const resolved = resolvedSchema(written, reading.components);
  const encoded = resolved?.['contentEncoding'];
  if (typeof encoded === 'string') {
    return unsentPart(`its part ${partOf.part} is written in ${encoded}, which a call does not send`);
  }
  const declared = declaredOf(encoding, resolved, reading);
  if (declared.length === 0) {
    return unsentPart(`its part ${partOf.part} may be of several types, and the document does not say which`);
  }
  const unread = declared.find((range) => !isMediaRange(range));
  return unread === undefined
    ? placeIn({ written, resolved, encoding, declared }, partOf, reading)
    : unsentPart(`its part ${partOf.part} takes ${unread}, which is not a media type`);
}
