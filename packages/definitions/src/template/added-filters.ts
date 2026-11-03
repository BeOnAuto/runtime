import { Option, Schema } from 'effect';
import type { FilterImplOptions } from 'liquidjs';

import { outputText } from './output-text.ts';

const defaultClipLength = 400;

const ellipsis = '…';

const decimalNumber = /^-?\d+(?:\.\d+)?$/u;

const whitespace = /\s+/u;

const wholeDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const dollarsAndCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function amountOf(value: unknown): number {
  const amount = typeof value === 'string' && decimalNumber.test(value.trim()) ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new TypeError('money takes a number, or text that is a decimal number');
  }
  return amount;
}

function money(value: unknown): string {
  const amount = amountOf(value);
  return Number.isInteger(amount) ? wholeDollars.format(amount) : dollarsAndCents.format(amount);
}

export function clip(value: unknown, length: unknown = defaultClipLength): string {
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError('clip takes a length in characters, a whole number of 0 or more');
  }
  const text = outputText(value);
  if (text.length <= length) {
    return text;
  }
  const characters = Array.from(text);
  return characters.length <= length ? text : `${characters.slice(0, length).join('')}${ellipsis}`;
}

function words(value: unknown): number {
  return outputText(value)
    .split(whitespace)
    .filter((word) => word !== '').length;
}

const RecalledMemorySchema = Schema.Struct({
  id: Schema.String,
  scope: Schema.String,
  text: Schema.String,
  written_at: Schema.String,
  written_by: Schema.String,
});

const RecalledSchema = Schema.Union([
  Schema.Struct({ memories: Schema.Array(RecalledMemorySchema) }),
  Schema.Array(RecalledMemorySchema),
]);

type RecalledMemory = typeof RecalledMemorySchema.Type;

const recalledOf = Schema.decodeUnknownOption(RecalledSchema);

export const memoriesRecalled = 'memories_recalled';

type Entities = ReadonlyArray<readonly [Readonly<RegExp>, string]>;

const textEntities: Entities = [
  [/&/gu, '&amp;'],
  [/</gu, '&lt;'],
  [/>/gu, '&gt;'],
];

const attributeEntities: Entities = [...textEntities, [/"/gu, '&quot;']];

function escapedWith(entities: Entities, text: string): string {
  return entities.reduce((escaping, [character, entity]) => escaping.replaceAll(character, entity), text);
}

function attribute(name: string, value: string): string {
  return `${name}="${escapedWith(attributeEntities, value)}"`;
}

function memoryLine({ id, scope, text, written_at: writtenAt, written_by: writtenBy }: RecalledMemory): string {
  const attributes = [
    attribute('id', id),
    attribute('scope', scope),
    attribute('written_at', writtenAt),
    attribute('written_by', writtenBy),
  ];
  return `<memory ${attributes.join(' ')}>${escapedWith(textEntities, text)}</memory>`;
}

function listOf(recalled: typeof RecalledSchema.Type): readonly RecalledMemory[] {
  return 'memories' in recalled ? recalled.memories : recalled;
}

const memories: FilterImplOptions = function memoriesOf(value: unknown): string {
  const recalled = Option.getOrUndefined(recalledOf(value));
  if (recalled === undefined) {
    throw new TypeError('memories takes what a recall answers, or its list of memories');
  }
  this.context.setRegister(memoriesRecalled, true);
  return listOf(recalled)
    .map((memory) => memoryLine(memory))
    .join('\n');
};

export const addedFilters = { money, clip, words, memories };
