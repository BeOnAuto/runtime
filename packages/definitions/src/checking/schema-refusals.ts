import {
  stringFormats,
  type Breach,
  type CompiledSchema,
  type FormatName,
  type FoundIssue,
} from '@on.auto/json-schema';
import { InvalidInput, type Issue } from '@on.auto/operations';
import { articled, asSentence } from '@on.auto/phrasing';
import { measureOf, mostValueDepth, valueAtPointer } from '@on.auto/workflow-engine';
import { Effect, JsonPointer, type Schema } from 'effect';

import { trailingWords } from '../schema-words/schema-bounds.ts';
import { forms } from '../schema-words/schema-nouns.ts';
import {
  isItemOf,
  listOf,
  namesAt,
  placeAt,
  typesOf,
  type JsonSchema,
  type PlaceStep,
  type SchemaPlace,
} from '../schema-words/schema-reading.ts';
import { descriptionOf, examplesWordsOf, expectedWordsOf, givesAnExample } from '../schema-words/schema-words.ts';

const kindKeywords = ['type', 'enum', 'const', 'anyOf', 'oneOf', 'properties', 'items', 'prefixItems'];

const receivedNouns: ReadonlyMap<string, string> = new Map([
  ['string', 'text'],
  ['number', 'a number'],
  ['boolean', 'yes or no'],
  ['null', 'nothing'],
  ['array', 'a list'],
  ['object', 'a record'],
]);

interface Breached {
  readonly schema: CompiledSchema;
  readonly tokens: readonly string[];
  readonly detail: string;
  readonly received: Schema.Json | undefined;
}

function withoutFullStop(text: string): string {
  return text.trim().replace(/\.$/u, '');
}

function asPhrase(words: string): string {
  const phrase = withoutFullStop(words);
  return `${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`;
}

function tokensOf(pointer: string): readonly string[] {
  return pointer
    .split('/')
    .slice(1)
    .map((token) => JsonPointer.unescapeToken(token));
}

function nameOf(step: PlaceStep): string {
  return isItemOf(step) ? `item ${Number(step.token) + 1}` : step.token;
}

function describedIn(schema: JsonSchema): readonly string[] {
  const description = descriptionOf(schema);
  return description === undefined ? [] : [description];
}

interface About {
  readonly description: string | undefined;
  readonly examples: Schema.JsonArray;
}

function aboutTheField(schemas: readonly JsonSchema[]): About {
  const [description] = schemas.flatMap((schema) => describedIn(schema));
  return { description, examples: schemas.flatMap((schema) => listOf(schema, 'examples')) };
}

function aboutOf(schemas: readonly JsonSchema[]): string {
  const { description, examples } = aboutTheField(schemas);
  return [
    ...(description === undefined ? [] : [withoutFullStop(description)]),
    ...examplesWordsOf(examples, description),
  ]
    .map((part) => `, ${part}`)
    .join('');
}

function givesItsOwnExample({ steps, schemas }: SchemaPlace): boolean {
  const { description, examples } = aboutTheField(schemas);
  return steps.length > 0 && givesAnExample(examples, description);
}

function fieldsOf({ steps, schemas }: SchemaPlace, root: string): string {
  return steps.length === 0 ? root : `${steps.map((step) => nameOf(step)).join(', then ')}${aboutOf(schemas)}`;
}

function subjectOf(place: SchemaPlace, what: string): string {
  return fieldsOf(place, `The ${what}`);
}

function missingWords(step: PlaceStep): string {
  return isItemOf(step) ? nameOf(step) : `the field ${step.token}`;
}

function refusedWords(steps: readonly PlaceStep[]): string {
  const [step] = steps.slice(-1);
  if (step === undefined) {
    return 'no value';
  }
  return isItemOf(step) ? `no ${nameOf(step)}` : `no field ${step.token}`;
}

function kindWords(schemas: readonly JsonSchema[], root: JsonSchema, detail: string): string {
  const said = schemas.find((schema) => kindKeywords.some((keyword) => schema[keyword] !== undefined));
  return said === undefined ? asPhrase(detail) : `expected ${expectedWordsOf(said, root)}`;
}

function kindOfValue(value: Schema.Json | undefined): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'array' : typeof value;
}

function kindsTakenBy(schema: JsonSchema): readonly string[] {
  const choices = schema['const'] === undefined ? listOf(schema, 'enum') : [schema['const']];
  return [
    ...typesOf(schema).map((type) => (type === 'integer' ? 'number' : type)),
    ...choices.map((choice) => kindOfValue(choice)),
  ];
}

function receivedWords(schemas: readonly JsonSchema[], received: Schema.Json | undefined): string {
  const taken = new Set(schemas.flatMap((schema) => kindsTakenBy(schema)));
  const kind = kindOfValue(received);
  const noun = receivedNouns.get(kind);
  return noun === undefined || taken.size === 0 || taken.has(kind) ? '' : `; it was given ${noun}`;
}

function holderSentence({ schema: { document, what }, tokens }: Breached, breach: Breach): string {
  const place = placeAt(document, tokens);
  const holder = subjectOf(placeAt(document, tokens.slice(0, -1)), what);
  if (breach.rule === 'unexpected') {
    return `${holder}: expected ${refusedWords(place.steps)}`;
  }
  const missing = place.steps.slice(-1).map((step) => missingWords(step));
  return `${holder}: expected ${missing.join('')}${aboutOf(place.schemas)}`;
}

function formWords(format: FormatName, field: SchemaPlace): string {
  const { one } = forms[format];
  return givesItsOwnExample(field) ? one : `${one} such as ${stringFormats[format].example}`;
}

function ruleWords(breach: Breach, field: SchemaPlace): string | undefined {
  if (breach.rule === 'bound') {
    return trailingWords(breach.keywords, []).join(', ');
  }
  return breach.rule === 'format' ? formWords(breach.format, field) : undefined;
}

function valueSentence({ schema: { document, what }, tokens, detail, received }: Breached, breach: Breach) {
  const place = placeAt(document, tokens);
  const rule = ruleWords(breach, place);
  return rule === undefined
    ? `${subjectOf(place, what)}: ${kindWords(place.schemas, document, detail)}${receivedWords(place.schemas, received)}`
    : `${subjectOf(place, what)}: expected ${rule}`;
}

function breachSentence(breached: Breached, breach: Breach): string {
  return breach.rule === 'missing' || breach.rule === 'unexpected'
    ? holderSentence(breached, breach)
    : valueSentence(breached, breach);
}

function nameSentence({ document, what }: CompiledSchema, tokens: readonly string[], { breach, detail }: FoundIssue) {
  const holding = tokens.slice(0, -1);
  const holder = placeAt(document, holding);
  const named = tokens.slice(-1).join('');
  if (breach?.rule === 'unexpected') {
    return `${subjectOf(holder, what)}: expected no name ${named}`;
  }
  const name = `the name ${named} of ${fieldsOf(holder, `the ${what}`)}`;
  if (breach === undefined) {
    return `${name}: ${asPhrase(detail)}`;
  }
  const rule = ruleWords(breach, holder);
  return rule === undefined
    ? `${name}: ${kindWords(namesAt(document, holding), document, detail)}`
    : `${name}: expected ${rule}`;
}

function sentenceOf(schema: CompiledSchema, issue: FoundIssue, value: Schema.Json): string {
  const { pointer, detail, breach, ofTheName } = issue;
  const tokens = tokensOf(pointer);
  if (ofTheName === true) {
    return nameSentence(schema, tokens, issue);
  }
  if (breach !== undefined) {
    return breachSentence({ schema, tokens, detail, received: valueAtPointer(value, pointer) }, breach);
  }
  return pointer === '' ? detail : `${subjectOf(placeAt(schema.document, tokens), schema.what)}: ${asPhrase(detail)}`;
}

export function wordedIssuesOf(schema: CompiledSchema, value: Schema.Json): readonly Issue[] {
  return schema
    .issuesOf(value)
    .map((issue) => ({ pointer: issue.pointer, detail: asSentence(sentenceOf(schema, issue, value)) }));
}

function sentencesOf(issues: readonly Issue[]): string {
  return issues.map(({ detail }) => detail).join(' ');
}

export function refusedInput(issues: readonly Issue[]): InvalidInput {
  return new InvalidInput({ detail: sentencesOf(issues), issues });
}

interface StatedRefusal {
  readonly detail: string;
  readonly issues: readonly Issue[];
}

export function refusedByTheInputSchema(refusal: StatedRefusal): InvalidInput {
  return new InvalidInput({ ...refusal, kind: 'input_schema' });
}

function tooDeepFor(noun: string): InvalidInput {
  return new InvalidInput({
    detail: `The input nests more than the ${mostValueDepth} levels ${articled(noun)} takes`,
    issues: [{ pointer: '', detail: `Expected a value nested at most ${mostValueDepth} levels deep` }],
  });
}

export function checkedInput(
  input: Schema.Json,
  schema: CompiledSchema | undefined,
  noun: string,
): Effect.Effect<Schema.Json, InvalidInput> {
  if (measureOf(input) === undefined) {
    return Effect.fail(tooDeepFor(noun));
  }
  const issues = schema === undefined ? [] : wordedIssuesOf(schema, input);
  return issues.length === 0
    ? Effect.succeed(input)
    : Effect.fail(refusedByTheInputSchema({ detail: sentencesOf(issues), issues }));
}
