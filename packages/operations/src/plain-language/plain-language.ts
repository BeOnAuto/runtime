import { counted } from '@on.auto/phrasing';

import type { Rejected } from '../outcome/outcome.ts';
import type { RejectionBecause } from '../outcome/rejection-because.ts';
import type { RejectionKind } from '../outcome/rejection.ts';

export type Remedies = Readonly<Partial<Record<RejectionBecause, string>>>;

export interface Explanation {
  readonly why: string;
  readonly remedy: string;
  readonly remedyOnRecord?: string;
  readonly mayHaveChanged?: true;
}

export const roleRefusal: Explanation = {
  why: 'your role in this organization does not allow that',
  remedy: 'Ask an admin of the organization to change your role.',
};

export const tokenTypeRefusal: Explanation = {
  why: 'only a person signed in to Studio can do that',
  remedy: 'An agent or an API key cannot do it, whatever access it was given.',
};

const second = { one: 'second', other: 'seconds' };

function busyRemedy(wait: string): string {
  return `Try again in ${wait}.`;
}

export const busyExplanation: Explanation = { why: 'the server is busy', remedy: busyRemedy('a few seconds') };

export function withTheWait(
  explanation: Explanation,
  { kind, retry_after: retryAfter }: Pick<Rejected, 'kind' | 'retry_after'>,
): Explanation {
  return kind === 'busy' && retryAfter !== undefined
    ? { ...explanation, remedy: busyRemedy(counted(retryAfter, second)) }
    : explanation;
}

export type Explanations = Readonly<Partial<Record<RejectionKind, Explanation>>>;

export interface RefusalTerms {
  readonly remedies?: Remedies | undefined;
  readonly explanations?: Explanations | undefined;
}

export interface PlainLanguage<Input, Output> {
  readonly task: string;
  readonly attempt: (input: Input) => string;
  readonly attemptAsOffered?: (input: unknown) => string | undefined;
  readonly outcome: (output: Output, input: Input) => string;
  readonly relayed?: (output: Output) => string | undefined;
  readonly remedies?: Remedies;
  readonly explanations?: Explanations;
}

export interface LinkToOpen {
  readonly message: string;
  readonly url: string;
}

export interface RegisteredPlainLanguage {
  readonly attempt: (input: unknown) => string;
  readonly outcome: (output: unknown, input: unknown) => string;
  readonly relayed?: (output: unknown) => string | undefined;
  readonly remedies: Remedies;
  readonly explanations?: Explanations;
}
