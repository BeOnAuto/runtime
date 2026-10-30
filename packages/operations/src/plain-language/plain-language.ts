import type { RejectionBecause } from '../outcome/rejection-because.ts';

export type Remedies = Readonly<Partial<Record<RejectionBecause, string>>>;

export interface Explanation {
  readonly why: string;
  readonly remedy: string;
  readonly remedyOnRecord?: string;
  readonly mayHaveChanged?: true;
}

export interface PlainLanguage<Input, Output> {
  readonly task: string;
  readonly attempt: (input: Input) => string;
  readonly outcome: (output: Output, input: Input) => string;
  readonly remedies?: Remedies;
}

export interface LinkToOpen {
  readonly message: string;
  readonly url: string;
}

export interface RegisteredPlainLanguage {
  readonly attempt: (input: unknown) => string;
  readonly outcome: (output: unknown, input: unknown) => string;
  readonly remedies: Remedies;
}
