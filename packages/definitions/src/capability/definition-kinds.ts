import type { PlaybookAddress } from '@on.auto/operations';
import type { Effect, Schema } from 'effect';

import type { Capability } from './capability.ts';

export interface PresentedDefinition {
  readonly type: string;
  readonly name: string;
}

export interface RunRejectionShown {
  readonly reason: string;
  readonly kind?: string;
  readonly detail?: string;
}

export type RunShown =
  | {
      readonly status: 'started' | 'succeeded';
      readonly output: Schema.Json;
      readonly started: string;
      readonly ended: string | null;
      readonly version: number;
    }
  | { readonly status: 'rejected'; readonly rejection: RunRejectionShown }
  | { readonly status: 'failed' };

export interface SubjectShown {
  readonly type: string;
  readonly name: string;
  readonly description: string | null;
  readonly version: number | null;
}

export interface PresentedPage {
  readonly name: string;
  readonly version: number;
  readonly source: string;
}

export interface Presenting {
  readonly subjectOf: (details: Schema.JsonObject | undefined) => string | undefined;
  readonly definitionPresentedBy: (details: Schema.JsonObject | undefined) => PresentedDefinition | undefined;
  readonly publishedDetails: (details: Schema.JsonObject | undefined) => Schema.JsonObject;
  readonly subjectLineOf: (source: string) => number;
  readonly resultOf: (page: PresentedPage, run: RunShown, subject: SubjectShown) => Effect.Effect<string | undefined>;
  readonly latelyOf: (
    page: PresentedPage,
    subject: SubjectShown,
    place: PlaybookAddress,
  ) => Effect.Effect<string | undefined>;
}

export interface DefinitionKind extends Capability {
  readonly neverRuns?: string;
  readonly presents?: Presenting;
}
