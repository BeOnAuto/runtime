import type { CallToolResult } from '@modelcontextprotocol/server';
import {
  mostOutcomeCharacters,
  mostRefusalCharacters,
  unsuccessfulWords,
  withinCharacters,
  type Cancelled,
  type Failed,
  type OperationKind,
  type RegisteredPlainLanguage,
  type Rejected,
  type Remedies,
  type Settled,
} from '@on.auto/operations';

import { problemOfOutcome } from '../problem/outcome-problem.ts';

export interface ToolWords {
  readonly kind: OperationKind;
  readonly plainLanguage: RegisteredPlainLanguage;
}

function textOf(text: string): { readonly type: 'text'; readonly text: string } {
  return { type: 'text', text };
}

export interface RefusalWords {
  readonly kind: OperationKind;
  readonly attempt: string;
  readonly remedies?: Remedies;
}

export function unsuccessfulResultOf(
  settled: Rejected | Failed | Cancelled,
  clientClosedRequest: boolean,
  { kind, attempt, remedies }: RefusalWords,
): CallToolResult {
  return {
    isError: true,
    content: [
      textOf(withinCharacters(unsuccessfulWords(attempt, kind, settled, remedies), mostRefusalCharacters)),
      textOf(JSON.stringify(problemOfOutcome(settled, clientClosedRequest))),
    ],
  };
}

export function toolResultOf(
  settled: Settled,
  clientClosedRequest: boolean,
  { kind, plainLanguage }: ToolWords,
  input: unknown,
): CallToolResult {
  if (settled.status === 'succeeded') {
    return {
      content: [
        textOf(withinCharacters(plainLanguage.outcome(settled.output, input), mostOutcomeCharacters)),
        textOf(JSON.stringify(settled.output)),
      ],
      structuredContent: settled.output,
    };
  }
  return unsuccessfulResultOf(settled, clientClosedRequest, {
    kind,
    attempt: plainLanguage.attempt(input),
    remedies: plainLanguage.remedies,
  });
}
