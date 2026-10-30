import { Data } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import type { Context } from '../ledger/context.ts';

export type RecordedOrder = 'asc' | 'desc';

export type RecordedSelection =
  | { readonly kind: 'everything' }
  | {
      readonly kind: 'runs';
      readonly notBeginningWith?: readonly string[];
      readonly definitionType?: string;
      readonly name?: string;
    }
  | { readonly kind: 'run'; readonly run: string }
  | { readonly kind: 'correlated'; readonly correlation: string };

export interface RecordedPageRequest {
  readonly cursor?: string;
  readonly order: RecordedOrder;
  readonly limit: number;
  readonly since?: string;
  readonly types?: readonly string[];
  readonly dataOf?: readonly string[];
}

export interface Trace {
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface RecordedFact extends Trace {
  readonly id: string;
  readonly causationId: string | null;
  readonly correlationId: string | null;
  readonly stream: string;
  readonly version: number;
  readonly globalPosition: number;
  readonly type: string;
  readonly data: unknown;
  readonly context: Context;
  readonly recordedAt: string;
}

export interface RecordedEvent extends RecordedFact {
  readonly cursor: string;
}

export interface ExaminedPlace {
  readonly cursor: string;
  readonly recordedAt: string;
}

export interface RecordedPage {
  readonly records: readonly RecordedEvent[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly lastExamined: ExaminedPlace | null;
}

export type InvalidCursorKind = 'malformed' | 'of_another_playbook';

export class InvalidCursor extends Data.TaggedError('invalid_cursor')<{ readonly kind: InvalidCursorKind }> {}

export type AppendedScope =
  | { readonly kind: 'playbook'; readonly playbook: PlaybookAddress }
  | { readonly kind: 'streams'; readonly streams: readonly string[] };

export interface AppendedFactsRequest {
  readonly after?: string;
  readonly most: number;
  readonly dataOf: readonly string[];
}

export interface AppendedFact {
  readonly cursor: string;
  readonly id: string;
  readonly stream: string;
  readonly type: string;
  readonly context: Context;
  readonly data: unknown;
}

export type AppendWaited = 'appended' | 'ended';

export interface AppendedFacts {
  readonly facts: readonly AppendedFact[];
  readonly cursor: string;
  readonly through: string;
  readonly more: boolean;
}
