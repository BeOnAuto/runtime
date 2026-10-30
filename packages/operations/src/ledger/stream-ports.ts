import type { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import type { Conflict } from '../outcome/conflict.ts';
import type { InvalidInput } from '../outcome/invalid-input.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import type { CursorNotHeld } from '../reading/cursor-not-held.ts';
import type {
  AppendedFacts,
  AppendedFactsRequest,
  AppendWaited,
  AppendedScope,
  InvalidCursor,
  RecordedFact,
  RecordedPage,
  RecordedPageRequest,
  RecordedSelection,
} from '../reading/recorded-read.ts';
import type { RunOutcomeGroup, RunOutcomeSelection, RunOutcomeWindow } from '../run-outcomes/run-outcomes.ts';
import type { DecidedState, Decider, Fold, Recorded, StreamState } from './decider.ts';
import type { Lineage } from './message-lineage.ts';

export interface StreamReader {
  readonly load: <State, Event extends Recorded>(
    stream: string,
    fold: Fold<State, Event>,
  ) => Effect.Effect<StreamState<State>>;
}

export interface StreamAges {
  readonly ageOfLastAppend: (stream: string) => Effect.Effect<number>;
}

export interface StreamWriter {
  readonly execute: <State, Command, Event extends Recorded, R extends DeclarableReason>(
    stream: string,
    decider: Decider<State, Command, Event, R>,
    command: Command,
    lineage?: Lineage,
  ) => Effect.Effect<DecidedState<State>, Rejection<R> | Conflict>;
}

export interface RecordedReader {
  readonly readRecorded: (
    playbook: PlaybookAddress,
    selection: RecordedSelection,
    page: RecordedPageRequest,
  ) => Effect.Effect<RecordedPage, InvalidCursor>;
  readonly readRecordedEvent: (playbook: PlaybookAddress, id: string) => Effect.Effect<RecordedFact | undefined>;
}

export interface PlaybookRecordedReader {
  readonly readRecorded: (
    selection: RecordedSelection,
    page: RecordedPageRequest,
  ) => Effect.Effect<RecordedPage, InvalidInput>;
  readonly readRecordedEvent: (id: string) => Effect.Effect<RecordedFact | undefined>;
}

export interface RunOutcomesReader {
  readonly readRunOutcomes: (
    playbook: PlaybookAddress,
    window: RunOutcomeWindow,
    selection: RunOutcomeSelection,
  ) => Effect.Effect<readonly RunOutcomeGroup[]>;
}

export interface PlaybookRunOutcomesReader {
  readonly readRunOutcomes: (
    window: RunOutcomeWindow,
    selection: RunOutcomeSelection,
  ) => Effect.Effect<readonly RunOutcomeGroup[]>;
}

export interface AppendedFactsReader {
  readonly readAppendedFacts: (
    scope: AppendedScope,
    request: AppendedFactsRequest,
  ) => Effect.Effect<AppendedFacts, CursorNotHeld>;
  readonly waitForAppend: (scope: AppendedScope, after: string, deadline: number) => Effect.Effect<AppendWaited>;
}

export interface PlaybookAppendedFactsReader {
  readonly readAppendedFacts: (request: AppendedFactsRequest) => Effect.Effect<AppendedFacts, CursorNotHeld>;
  readonly waitForAppend: (after: string, deadline: number) => Effect.Effect<AppendWaited>;
}

export interface OrgAppendedFactsReader {
  readonly readAppendedFacts: (
    streams: readonly string[],
    request: AppendedFactsRequest,
  ) => Effect.Effect<AppendedFacts, CursorNotHeld>;
  readonly waitForAppend: (streams: readonly string[], after: string, deadline: number) => Effect.Effect<AppendWaited>;
}
