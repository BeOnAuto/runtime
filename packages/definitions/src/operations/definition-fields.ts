import { Buffer } from 'node:buffer';

import { Schema, SchemaTransformation } from 'effect';

import { jsonBytesOf, mostInputBytes, mostInputDepth, nestsWithin } from '../runs/recorded-size.ts';

const mostSourceBytes = 65_536;

const mostOverviewBytes = 16_384;

function atMostBytes(most: number, written: string) {
  return Schema.makeFilter((text: string) => Buffer.byteLength(text, 'utf8') <= most, {
    expected: `${written} of at most ${most} bytes in UTF-8`,
    toJsonSchema: () => [{ maxLength: most }, true],
  });
}

export const definitionNamePattern = /^[a-z][a-z0-9-]{2,47}$/u;

function definitionNameFieldOf(description: string) {
  return Schema.String.annotate({ description }).check(Schema.isPattern(definitionNamePattern));
}

export const DefinitionNameField = definitionNameFieldOf(
  'The definition name: 3 to 48 lowercase letters, digits and hyphens, starting with a letter',
);

export const RunsOfNameField = definitionNameFieldOf('Only the runs of the definition with this name');

export const SourceField = Schema.String.annotate({
  description: `The definition document in its type's format, at most ${mostSourceBytes} bytes in UTF-8`,
}).check(atMostBytes(mostSourceBytes, 'a document'));

export const OverviewField = Schema.String.annotate({
  description:
    'Markdown for the person who runs the business, written from everything you know of them and of the playbook: why this exists, what it does and how it fits, in one to three short paragraphs, with a Mermaid diagram in a fenced block where a flow is worth a picture; less technical, more value.',
}).check(Schema.isMinLength(1), atMostBytes(mostOverviewBytes, 'an overview'));

export const RunIdInputField = Schema.String.annotate({
  description: "The run's id, a UUID in any case, kept in lowercase",
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

function fitsInInputLimit(input: Schema.Json): boolean {
  return jsonBytesOf(input) <= mostInputBytes;
}

export const InputField = Schema.Json.annotate({
  description: `The run input: any JSON value the definition takes, {} when left out, at most ${mostInputBytes} bytes as JSON in UTF-8 and ${mostInputDepth} levels deep`,
}).check(
  Schema.makeFilter(fitsInInputLimit, { expected: `an input of at most ${mostInputBytes} bytes as JSON in UTF-8` }),
  Schema.makeFilter((input: Schema.Json) => nestsWithin(input, mostInputDepth), {
    expected: `an input that nests at most ${mostInputDepth} levels deep`,
  }),
);

export const IncludeRetiredField = Schema.Boolean.annotate({
  description: 'Whether to list retired definitions as well; false when left out',
});
