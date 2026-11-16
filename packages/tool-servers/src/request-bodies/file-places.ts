import { Predicate, Result, type Schema } from 'effect';

import { isSchemaObject } from '../openapi/schema-translation.ts';
import { covers, essenceOf, isMediaType, isSpecific, plainText, sentAs } from './media-types.ts';

export interface FilePlace {
  readonly kind: 'file';
  readonly declared: readonly string[];
  readonly schema: Schema.Json;
}

interface JsonPlace {
  readonly kind: 'json';
  readonly mediaType: string;
  readonly schema: Schema.Json;
}

interface FieldPlace {
  readonly kind: 'field';
  readonly schema: Schema.Json;
}

export type Place = FilePlace | JsonPlace | FieldPlace;

export interface SentPart {
  readonly mediaType: string;
  readonly text: string;
}

type Placed = Result.Result<SentPart, string>;

interface TextWithItsType {
  readonly media_type: string;
  readonly text: string;
}

const formMembers = ['media_type', 'text'];

const formShape = '{ "media_type": …, "text": … }';

function isTextWithItsType(value: unknown): value is TextWithItsType {
  return (
    Predicate.isObject(value) &&
    !Array.isArray(value) &&
    Object.keys(value).length === formMembers.length &&
    Predicate.hasProperty(value, 'media_type') &&
    Predicate.hasProperty(value, 'text') &&
    typeof value.media_type === 'string' &&
    typeof value.text === 'string'
  );
}

function listedAsWritten(declared: readonly string[]): string {
  return declared.join(', ');
}

function onlyTypeOf({ declared }: FilePlace): string | undefined {
  const [only] = declared;
  return declared.length === 1 && only !== undefined && isSpecific(only) ? only : undefined;
}

function takesPlainText({ declared }: FilePlace): boolean {
  return declared.some((range) => covers(range, plainText));
}

function bareTypeOf(place: FilePlace): string | undefined {
  return onlyTypeOf(place) ?? (takesPlainText(place) ? plainText : undefined);
}

function kindOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'a list' : 'an object';
}

function statedAt(place: FilePlace, { media_type: given, text }: TextWithItsType, pointer: string): Placed {
  return isMediaType(given) && place.declared.some((range) => covers(range, given))
    ? Result.succeed({ mediaType: sentAs(given), text })
    : Result.fail(
        `The argument ${pointer} gives the media type ${given}, and this operation takes ${listedAsWritten(place.declared)} there; give one of those.`,
      );
}

function bareAt(place: FilePlace, text: string, pointer: string): Placed {
  const type = bareTypeOf(place);
  return type === undefined
    ? Result.fail(
        `The argument ${pointer} is a text with no media type, and this operation takes ${listedAsWritten(place.declared)} there; give the text as ${formShape} with one of those.`,
      )
    : Result.succeed({ mediaType: sentAs(type), text });
}

function fileAt(place: FilePlace, value: unknown, pointer: string): Placed {
  if (isTextWithItsType(value)) {
    return statedAt(place, value, pointer);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return bareAt(place, String(value), pointer);
  }
  return Result.fail(
    `The argument ${pointer} is ${kindOf(value)}, and this operation takes a text there, alone or as ${formShape}.`,
  );
}

export function sentAt(place: Place, value: unknown, pointer: string): Placed {
  if (place.kind === 'json') {
    return Result.succeed({ mediaType: sentAs(place.mediaType), text: JSON.stringify(value) });
  }
  return place.kind === 'field'
    ? fileAt({ kind: 'file', declared: [plainText], schema: place.schema }, value, pointer)
    : fileAt(place, value, pointer);
}

function describedBy(schema: Schema.Json): { readonly description?: string } {
  const description = Predicate.hasProperty(schema, 'description') ? schema.description : undefined;
  return typeof description === 'string' ? { description } : {};
}

const textTypes: ReadonlySet<unknown> = new Set(['string', 'number', 'integer', 'boolean']);

function isATextSchema(schema: Schema.Json): boolean {
  const type = Predicate.hasProperty(schema, 'type') ? schema.type : undefined;
  return Array.isArray(type) ? type.length > 0 && type.every((each) => textTypes.has(each)) : textTypes.has(type);
}

const endOfASentence = /[.!?]$/u;

function saidWith(written: string | undefined, sentence: string): string {
  if (written === undefined || written.trim() === '') {
    return sentence;
  }
  const said = written.trim();
  return `${endOfASentence.test(said) ? said : `${said}.`} ${sentence}`;
}

function textWithItsTypeSchema(place: FilePlace): Schema.JsonObject {
  const specific = place.declared.every((range) => isSpecific(range));
  return {
    type: 'object',
    description: 'A text with its media type.',
    properties: {
      media_type: {
        type: 'string',
        description: 'What the text is, as a media type.',
        ...(specific ? { enum: place.declared.map((range) => essenceOf(range)) } : {}),
      },
      text: { type: 'string' },
    },
    required: formMembers,
    additionalProperties: false,
  };
}

function oneTypeSchema(place: FilePlace, only: string): Schema.Json {
  const description = saidWith(describedBy(place.schema).description, `A text, sent as ${essenceOf(only)}.`);
  return isSchemaObject(place.schema) && isATextSchema(place.schema)
    ? Object.fromEntries([...Object.entries(place.schema), ['description', description]])
    : { type: 'string', description };
}

function fileSchemaOf(place: FilePlace): Schema.Json {
  const only = onlyTypeOf(place);
  if (only !== undefined) {
    return oneTypeSchema(place, only);
  }
  const form = textWithItsTypeSchema(place);
  const members = takesPlainText(place)
    ? [{ type: 'string', description: `A text, sent as ${plainText}.` }, form]
    : [form];
  return members.length === 1 ? form : { ...describedBy(place.schema), anyOf: members };
}

export function placeSchemaOf(place: Place): Schema.Json {
  return place.kind === 'file' ? fileSchemaOf(place) : place.schema;
}
