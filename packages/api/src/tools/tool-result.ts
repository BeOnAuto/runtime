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
import type { Problem } from '../problem/problem-document.ts';

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

function unsuccessfulResultWith(words: string, problem: Problem): CallToolResult {
  return {
    isError: true,
    content: [textOf(withinCharacters(words, mostRefusalCharacters)), textOf(JSON.stringify(problem))],
  };
}

export function unsuccessfulResultOf(
  settled: Rejected | Failed | Cancelled,
  clientClosedRequest: boolean,
  { kind, attempt, remedies, explanations }: RefusalWords,
): CallToolResult {
  return unsuccessfulResultWith(
    unsuccessfulWords(attempt, kind, settled, { remedies, explanations }),
    problemOfOutcome(settled, clientClosedRequest),
  );
}

/**
 * A call refused before it reached any tool, in the shape of every refused call: the refusal's own words, with
 * nothing around them, then its problem document.
 */
export function refusedResultOf(refusal: Rejected): CallToolResult {
  return unsuccessfulResultWith(refusal.detail, problemOfOutcome(refusal, false));
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
