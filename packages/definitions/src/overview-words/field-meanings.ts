import { oneLine } from '../overview/markdown-text.ts';
import { placeAt, propertiesOf, textOf, type JsonSchema } from '../overview/schema-reading.ts';
import { charactersIn } from '../plain-language/characters.ts';
import { nameInWords } from '../plain-language/in-words.ts';
import type { VariableSegment } from '../template/template-parsing.ts';

export type Listing = 'alone' | 'among-others';

export const mostMeaningCharacters = 60;

const nounPhraseOpeners: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'its',
  'their',
  'each',
  'every',
  'one',
  'how',
  'what',
  'which',
  'who',
  'where',
  'whether',
]);

const clauseEnd = /\. |[;:]/u;

const listSeparator = ', ';

const openingWord = /^(\p{L}+)\s+\S/u;

const endingStop = /\.$/u;

const noLoops: ReadonlySet<string> = new Set();

const moments: ReadonlyMap<string, string> = new Map([
  ['today', "today's date"],
  ['now', 'the time now'],
]);

function clauseOf(description: string, listing: Listing): string {
  const [ended = ''] = oneLine(description).trim().split(clauseEnd, 1);
  const [listed = ''] = listing === 'among-others' ? ended.split(listSeparator, 1) : [ended];
  return listed.trim().replace(endingStop, '');
}

function nounPhraseOf(clause: string): string | undefined {
  const word = openingWord.exec(clause)?.[1];
  if (word === undefined || !nounPhraseOpeners.has(word.toLowerCase())) {
    return undefined;
  }
  return charactersIn(clause) <= mostMeaningCharacters
    ? `${word.toLowerCase()}${clause.slice(word.length)}`
    : undefined;
}

function nameAsWords(name: string): string {
  const words = nameInWords(name);
  return words === '' ? name : words;
}

export function meaningOfDescription(description: string, listing: Listing): string | undefined {
  return nounPhraseOf(clauseOf(description, listing));
}

export function fieldMeaning(name: string, description: string | undefined, listing: Listing): string {
  return (
    (description === undefined ? undefined : meaningOfDescription(description, listing)) ?? `the ${nameAsWords(name)}`
  );
}

function listingOf(holders: readonly JsonSchema[]): Listing {
  const names = new Set(holders.flatMap((holder) => propertiesOf(holder).map(([name]) => name)));
  return names.size > 1 ? 'among-others' : 'alone';
}

export function meaningAt(schema: JsonSchema, path: readonly string[], name: string): string {
  const description = placeAt(schema, path)
    .schemas.map((each) => textOf(each, 'description'))
    .find((written) => written !== undefined);
  return fieldMeaning(name, description, listingOf(placeAt(schema, path.slice(0, -1)).schemas));
}

function lastNameOf(path: readonly VariableSegment[]): string {
  return path.findLast((segment) => typeof segment === 'string') ?? 'value';
}

function inputMeaning(path: readonly VariableSegment[], inputSchema: JsonSchema | undefined): string {
  const within = path.slice(1);
  if (within.length === 0) {
    return fieldMeaning('input', inputSchema === undefined ? undefined : textOf(inputSchema, 'description'), 'alone');
  }
  const tokens = within.flatMap((segment) => (segment === null ? [] : [String(segment)]));
  const name = lastNameOf(path);
  return inputSchema === undefined || tokens.length < within.length
    ? `the ${nameAsWords(name)}`
    : meaningAt(inputSchema, tokens, name);
}

export function valueMeaning(
  path: readonly VariableSegment[],
  inputSchema: JsonSchema | undefined,
  loopVariables: ReadonlySet<string> = noLoops,
): string {
  const root = String(path[0]);
  const moment = path.length === 1 ? moments.get(root) : undefined;
  if (moment !== undefined) {
    return moment;
  }
  if (loopVariables.has(root)) {
    return nameAsWords(lastNameOf(path));
  }
  return root === 'input' ? inputMeaning(path, inputSchema) : `the ${nameAsWords(lastNameOf(path))}`;
}
