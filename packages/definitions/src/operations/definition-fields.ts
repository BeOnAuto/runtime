import { Buffer } from 'node:buffer';

import { Schema, SchemaTransformation } from 'effect';

import { jsonBytesOf, mostInputBytes, mostInputDepth, nestsWithin } from '../runs/recorded-size.ts';

const mostSourceBytes = 65_536;

const mostOverviewBytes = 16_384;

const mostDiagramBytes = 8192;

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
    'Write a plain-language Markdown overview: what this definition does, why it is needed, and how it fits the playbook. Use only supplied context, in one to three short paragraphs, with no diagram. Avoid invented benefits.',
}).check(Schema.isMinLength(1), atMostBytes(mostOverviewBytes, 'an overview'));

const noDiagram = 'none';

const startsAsAFlow =
  /^\s*(?:(?:graph|flowchart)(?:[^\S\n]+(?:TD|TB|LR|RL|BT))?[^\S\n]*;?|stateDiagram(?:-v2)?)[^\S\n]*(?:\n|$)/iu;

function isADiagramChoice(diagram: string): boolean {
  return diagram === noDiagram || startsAsAFlow.test(diagram);
}

export const DiagramField = Schema.String.annotate({
  description:
    'Required for a function, refused for a workflow: Mermaid source of a flowchart or a state diagram of how the function works, its first line flowchart, graph or stateDiagram, or the word none when a picture would add nothing',
}).check(
  Schema.makeFilter(isADiagramChoice, {
    expected:
      'Mermaid source of a flowchart or a state diagram, whose first line is flowchart, graph or stateDiagram, or the word none',
  }),
  atMostBytes(mostDiagramBytes, 'a diagram'),
);

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

export const SampleOutputField = Schema.Json.annotate({
  description: 'With render, an output to render result over, as of a run that succeeded',
}).check(
  Schema.makeFilter(fitsInInputLimit, { expected: `an output of at most ${mostInputBytes} bytes as JSON in UTF-8` }),
  Schema.makeFilter((output: Schema.Json) => nestsWithin(output, mostInputDepth), {
    expected: `an output that nests at most ${mostInputDepth} levels deep`,
  }),
);

export const RenderField = Schema.Boolean.annotate({
  description: 'True to render its page now',
});
