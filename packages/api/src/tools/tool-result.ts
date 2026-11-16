import type { CallToolResult } from '@modelcontextprotocol/server';
import {
  unsuccessfulWords,
  type Cancelled,
  type Failed,
  type OperationKind,
  type RegisteredPlainLanguage,
  type Rejected,
  type RefusalTerms,
  type Settled,
} from '@on.auto/operations';
import {
  mostOutcomeCharacters,
  mostRefusalCharacters,
  mostRelayedCharacters,
  withinCharacters,
} from '@on.auto/phrasing';

import { problemOfOutcome } from '../problem/outcome-problem.ts';

export interface ToolWords {
  readonly kind: OperationKind;
  readonly plainLanguage: RegisteredPlainLanguage;
}

function textOf(text: string): { readonly type: 'text'; readonly text: string } {
  return { type: 'text', text };
}

export interface RefusalWords extends RefusalTerms {
  readonly kind: OperationKind;
  readonly attempt: string;
}

export function unsuccessfulResultOf(
  settled: Rejected | Failed | Cancelled,
  clientClosedRequest: boolean,
  { kind, attempt, remedies, explanations }: RefusalWords,
): CallToolResult {
  return {
    isError: true,
    content: [
      textOf(
        withinCharacters(unsuccessfulWords(attempt, kind, settled, { remedies, explanations }), mostRefusalCharacters),
      ),
      textOf(JSON.stringify(problemOfOutcome(settled, clientClosedRequest))),
    ],
  };
}

interface WordsOfTheOutput {
  readonly words: string;
  readonly heldByTheOutput: boolean;
}

function wordsOfTheOutput(
  { outcome, relayed }: RegisteredPlainLanguage,
  output: object,
  input: unknown,
): WordsOfTheOutput {
  const toRelay = relayed?.(output);
  const told = toRelay ?? outcome(output, input);
  return {
    words: withinCharacters(told, toRelay === undefined ? mostOutcomeCharacters : mostRelayedCharacters),
    heldByTheOutput: Object.values(output).includes(told),
  };
}

export function toolResultOf(
  settled: Settled,
  clientClosedRequest: boolean,
  { kind, plainLanguage }: ToolWords,
  input: unknown,
): CallToolResult {
  if (settled.status === 'succeeded') {
    const { words, heldByTheOutput } = wordsOfTheOutput(plainLanguage, settled.output, input);
    return {
      content: [textOf(words), textOf(JSON.stringify(settled.output))],
      structuredContent: heldByTheOutput
        ? settled.output
        : Object.fromEntries([['in_words', words], ...Object.entries(settled.output)]),
    };
  }
  return unsuccessfulResultOf(settled, clientClosedRequest, {
    kind,
    attempt: plainLanguage.attempt(input),
    remedies: plainLanguage.remedies,
    explanations: plainLanguage.explanations,
  });
}
