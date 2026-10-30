import { Buffer } from 'node:buffer';

import { Option, Schema } from 'effect';

const WordsSchema = Schema.Record(Schema.String, Schema.Array(Schema.String));

const RulePartSchema = Schema.Union([
  Schema.Struct({ from: Schema.Literal('word'), words: WordsSchema }),
  Schema.Struct({ from: Schema.Literals(['rest', 'text']) }),
]);

export const ReplyRuleSchema = Schema.Record(Schema.String, RulePartSchema);

export type ReplyRule = typeof ReplyRuleSchema.Type;

export type RulePart = typeof RulePartSchema.Type;

const PartFromSchema = Schema.Literals(['word', 'rest', 'text']);

export const WrittenRuleSchema = Schema.Record(
  Schema.String,
  Schema.Union([PartFromSchema, Schema.Struct({ from: PartFromSchema, words: Schema.optionalKey(WordsSchema) })]),
);

export type WrittenRule = typeof WrittenRuleSchema.Type;

export const replyRuleBounds = { values: 16, wordsPerValue: 16, wordBytes: 64 } as const;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const punctuation = /^[\p{P}\p{S}]+$/u;

export function normalizedWord(text: string): string {
  const parts = Array.from(graphemes.segment(text.toLowerCase()), ({ segment }: Readonly<Intl.SegmentData>) => segment);
  const first = parts.findIndex((part) => !punctuation.test(part));
  const last = parts.findLastIndex((part) => !punctuation.test(part));
  return first === -1 ? '' : parts.slice(first, last + 1).join('');
}

export interface StringProperty {
  readonly values: readonly string[] | undefined;
}

const decodeProperties = Schema.decodeUnknownOption(
  Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) }),
);

const decodeStringProperty = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.Literal('string'), enum: Schema.optionalKey(Schema.Array(Schema.Unknown)) }),
);

const decodeRequired = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.Literal('object'), required: Schema.Array(Schema.Unknown) }),
);

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

export function stringPropertiesOf(schema: Schema.JsonObject): ReadonlyMap<string, StringProperty> {
  const properties = Option.match(decodeProperties(schema), { onNone: () => ({}), onSome: (kept) => kept.properties });
  return new Map(
    Object.entries(properties).flatMap(([name, property]: readonly [string, unknown]) =>
      Option.match(decodeStringProperty(property), {
        onNone: () => [],
        onSome: (kept) => [[name, { values: kept.enum?.filter((value) => isText(value)) }] as const],
      }),
    ),
  );
}

function requiredOf(schema: Schema.JsonObject): readonly string[] {
  return Option.match(decodeRequired(schema), {
    onNone: () => [],
    onSome: ({ required }) => required.filter((name) => isText(name)),
  });
}

export function derivedRule(schema: Schema.JsonObject): ReplyRule | undefined {
  const required = requiredOf(schema);
  const [name] = required;
  const property = name === undefined ? undefined : stringPropertiesOf(schema).get(name);
  if (required.length !== 1 || name === undefined || property === undefined) {
    return undefined;
  }
  return property.values === undefined
    ? { [name]: { from: 'text' } }
    : { [name]: { from: 'word', words: Object.fromEntries(property.values.map((value) => [value, []])) } };
}

export function wordBytesOf(word: string): number {
  return Buffer.byteLength(word, 'utf8');
}

function valueFor(words: Extract<RulePart, { readonly from: 'word' }>, first: string): string | undefined {
  const said = normalizedWord(first);
  return Object.entries(words.words).find(
    ([value, listed]: readonly [string, readonly string[]]) =>
      normalizedWord(value) === said || listed.some((word) => normalizedWord(word) === said),
  )?.[0];
}

interface Split {
  readonly first: string;
  readonly rest: string;
  readonly whole: string;
}

function splitOf(words: string): Split {
  const whole = words.trim();
  const [first = ''] = whole.split(/\s+/u, 1);
  return { first, rest: whole.slice(first.length).trim(), whole };
}

type PartRead = { readonly unread: true } | { readonly value: string | null };

const unread: PartRead = { unread: true };

function partValue(part: RulePart, split: Split): PartRead {
  if (part.from === 'word') {
    const value = valueFor(part, split.first);
    return value === undefined ? unread : { value };
  }
  if (part.from === 'text') {
    return { value: split.whole };
  }
  return { value: split.rest === '' ? null : split.rest };
}

interface PropertyRead {
  readonly property: string;
  readonly read: PartRead;
}

export function answerOfReply(rule: ReplyRule, words: string): Schema.JsonObject | undefined {
  const split = splitOf(words);
  const reads = Object.entries(rule).map(([property, part]: readonly [string, RulePart]): PropertyRead => ({
    property,
    read: partValue(part, split),
  }));
  if (split.whole === '' || reads.some(({ read }) => 'unread' in read)) {
    return undefined;
  }
  return Object.fromEntries(
    reads.flatMap(({ property, read }) => ('value' in read && read.value !== null ? [[property, read.value]] : [])),
  );
}
