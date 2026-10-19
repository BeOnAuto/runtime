import type { Schema } from 'effect';

import { below, entriesOf, type FileProblem } from './file-problem.ts';
import { fallbacksIn, holdsReference, literalTextOf, placeholdersIn, placeholdersReplaced } from './references.ts';

const credentialWords: ReadonlySet<string> = new Set([
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'passwd',
  'password',
  'secret',
  'token',
]);

const credentialPairs = /(?:^|-)(?:api|access|private|secret)-key(?:-|$)/u;

const credentialShapes: readonly RegExp[] = [
  /^(?:basic|bearer|digest|token)\s+\S/iu,
  /^sk-[\w-]{16,}/u,
  /^[rs]k[-_](?:live|test)[-_]\w/u,
  /^AKIA[0-9A-Z]{16}$/u,
  /^AIza[\w-]{35}$/u,
  /^gh[opsu]_\w{20,}/u,
  /^github_pat_\w+/u,
  /^xox[abprs]-/u,
  /^abk_[a-z0-9-]+_[\w-]{43}$/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
];

const advice =
  'Looks like a credential, which this file never holds; write a reference to the environment variable that holds it instead, such as ${GATEWAY_API_KEY}';

export const credentialAsDefault =
  'Holds a reference whose default looks like a credential, which this file never holds; set the variable the reference names instead of writing a default';

function namesCredential(name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z0-9]+/u);
  return (
    name.toLowerCase() === 'key' ||
    words.some((word) => credentialWords.has(word)) ||
    credentialPairs.test(words.join('-'))
  );
}

function isWhollyPlaceholders(value: string): boolean {
  return placeholdersIn(value).length > 0 && placeholdersReplaced(value, () => '') === '';
}

function isLiteral(value: string): boolean {
  return !holdsReference(value) && !isWhollyPlaceholders(value);
}

function namedAsCredential(name: string, value: string): boolean {
  return namesCredential(name) && isLiteral(value);
}

function looksLikeCredential(text: string): boolean {
  const literal = literalTextOf(text).trim();
  return credentialShapes.some((shape: Readonly<RegExp>) => shape.test(literal));
}

function queryHoldsCredential(text: string): boolean {
  const url = URL.parse(text.trim());
  return (
    url !== null &&
    [...url.searchParams].some(([name, value]: readonly [string, string]) => namedAsCredential(name, value))
  );
}

function urlHoldsCredential(text: string): boolean {
  const url = URL.parse(literalTextOf(text).trim());
  if (url === null) {
    return false;
  }
  return (
    url.password !== '' ||
    looksLikeCredential(url.username) ||
    [...url.searchParams.values()].some((value) => looksLikeCredential(value)) ||
    queryHoldsCredential(text)
  );
}

function assignsCredential(text: string): boolean {
  const equals = text.indexOf('=');
  return equals >= 0 && looksLikeCredential(text.slice(equals + 1));
}

function isWrittenOutCredential(name: string, text: string, sorts: readonly string[]): boolean {
  return (
    (!sorts.includes(name) && namedAsCredential(name, text)) ||
    looksLikeCredential(text) ||
    urlHoldsCredential(text) ||
    assignsCredential(text)
  );
}

function holdsCredentialAsDefault(name: string, text: string, sorts: readonly string[]): boolean {
  return fallbacksIn(text).some((fallback) => fallback !== '' && isWrittenOutCredential(name, fallback, sorts));
}

function textProblems(name: string, text: string, pointer: string, sorts: readonly string[]): readonly FileProblem[] {
  if (isWrittenOutCredential(name, text, sorts)) {
    return [{ pointer, detail: advice }];
  }
  return holdsCredentialAsDefault(name, text, sorts) ? [{ pointer, detail: credentialAsDefault }] : [];
}

export function credentialProblems(
  name: string,
  value: Schema.Json,
  pointer: string,
  sortsOfCredential: readonly string[] = [],
): readonly FileProblem[] {
  if (typeof value === 'string') {
    return textProblems(name, value, pointer, sortsOfCredential);
  }
  const isList = Array.isArray(value);
  return entriesOf(value).flatMap(([key, item]) =>
    credentialProblems(isList ? name : key, item, below(pointer, key), sortsOfCredential),
  );
}
