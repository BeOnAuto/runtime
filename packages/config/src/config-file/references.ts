import type { Schema } from 'effect';

import type { Environment } from '../server-config.ts';
import { below, entriesOf, type FileProblem, type JsonEntry } from './file-problem.ts';

export interface Reference {
  readonly pointer: string;
  readonly value: string | null;
}

export interface Substituted {
  readonly value: Schema.Json;
  readonly problems: readonly FileProblem[];
  readonly references: readonly Reference[];
}

interface Resolution {
  readonly text: string;
  readonly problem: string | undefined;
  readonly reference?: { readonly value: string | null };
}

interface EntrySubstitution {
  readonly key: string;
  readonly result: Substituted;
}

interface Piece {
  readonly kind: 'text' | 'escape' | 'reference';
  readonly text: string;
}

const variableName = '[A-Za-z_][A-Za-z0-9_]*';

export const variableNamePattern = new RegExp(`^${variableName}$`, 'u');

const environmentReference = new RegExp(`^\\$\\{(?:env:)?(${variableName})(?::-([^}]*))?\\}$`, 'u');

const notAReference =
  'Holds a ${…} that is not a reference to an environment variable; write ${NAME}, or $$ for a literal $';

function pieceAt(text: string, dollar: number, close: number): Piece | undefined {
  if (text.startsWith('$$', dollar)) {
    return { kind: 'escape', text: '$$' };
  }
  return text.startsWith('${', dollar) && close !== -1
    ? { kind: 'reference', text: text.slice(dollar, close + 1) }
    : undefined;
}

function textPieces(text: string): readonly Piece[] {
  return text === '' ? [] : [{ kind: 'text', text }];
}

function piecesOf(text: string): readonly Piece[] {
  const found: Piece[] = [];
  let textFrom = 0;
  let close = text.indexOf('}');
  let dollar = text.indexOf('$');
  while (dollar !== -1) {
    if (close !== -1 && close < dollar + 2) {
      close = text.indexOf('}', dollar + 2);
    }
    const piece = pieceAt(text, dollar, close);
    if (piece === undefined) {
      dollar = text.indexOf('$', dollar + 1);
    } else {
      found.push(...textPieces(text.slice(textFrom, dollar)), piece);
      textFrom = dollar + piece.text.length;
      dollar = text.indexOf('$', textFrom);
    }
  }
  return [...found, ...textPieces(text.slice(textFrom))];
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function plain(piece: string): Resolution {
  return { text: piece, problem: undefined };
}

function failed(problem: string): Resolution {
  return { text: '', problem };
}

function resolved(piece: Piece, environment: Environment): Resolution {
  if (piece.kind === 'escape') {
    return plain('$');
  }
  if (piece.kind === 'text') {
    return plain(piece.text);
  }
  const reference = environmentReference.exec(piece.text);
  if (reference === null) {
    return failed(notAReference);
  }
  const [, name = '', fallback] = reference;
  const value = environment[name];
  if (isSet(value)) {
    return { ...plain(value), reference: { value } };
  }
  return fallback === undefined
    ? failed(`Refers to the environment variable ${name}, which is not set`)
    : { ...plain(fallback), reference: { value: null } };
}

function substitutedText(textWithReferences: string, pointer: string, environment: Environment): Substituted {
  const resolutions = piecesOf(textWithReferences).map((piece) => resolved(piece, environment));
  return {
    value: resolutions.map((resolution) => resolution.text).join(''),
    problems: resolutions.flatMap(({ problem }) => (problem === undefined ? [] : [{ pointer, detail: problem }])),
    references: resolutions.flatMap(({ reference }) =>
      reference === undefined ? [] : [{ pointer, value: reference.value }],
    ),
  };
}

export function literalTextOf(textWithReferences: string): string {
  return piecesOf(textWithReferences)
    .filter((piece) => piece.kind !== 'reference')
    .map((piece) => piece.text)
    .join('');
}

export function referencedVariablesOf(value: Schema.Json): readonly string[] {
  if (typeof value === 'string') {
    return piecesOf(value).flatMap((piece) => {
      const [, name] = environmentReference.exec(piece.text) ?? [];
      return name === undefined ? [] : [name];
    });
  }
  return entriesOf(value).flatMap(([, item]) => referencedVariablesOf(item));
}

export function holdsReference(textWithReferences: string): boolean {
  return piecesOf(textWithReferences).some((piece) => environmentReference.test(piece.text));
}

export function substituted(value: Schema.Json, pointer: string, environment: Environment): Substituted {
  if (typeof value === 'string') {
    return substitutedText(value, pointer, environment);
  }
  const results = entriesOf(value).map(([key, item]): EntrySubstitution => ({
    key,
    result: substituted(item, below(pointer, key), environment),
  }));
  const entries = results.map(({ key, result }: EntrySubstitution): JsonEntry => [key, result.value]);
  const problems = results.flatMap(({ result }: EntrySubstitution) => result.problems);
  const references = results.flatMap(({ result }: EntrySubstitution) => result.references);
  if (Array.isArray(value)) {
    return { value: entries.map(([, item]) => item), problems, references };
  }
  return typeof value === 'object' && value !== null
    ? { value: Object.fromEntries(entries), problems, references }
    : { value, problems, references };
}
