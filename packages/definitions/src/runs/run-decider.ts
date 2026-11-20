import {
  Conflict,
  PlaybookContext,
  PlaybookReader,
  PlaybookWriter,
  streamPrefixOfDefinition,
  streamPrefixOfPlaybook,
  type Decider,
  type LedgerPorts,
  type Lineage,
  type PlaybookAddress,
  type Rejection,
  type StreamAges,
  type StreamReader,
  type StreamState,
  type StreamWriter,
  runStreamNameOf,
} from '@on.auto/operations';
import { Effect, Equal, Result } from 'effect';

import type { AdmitsFact } from '../run-work/work-decisions.ts';
import type { RunCommand, RunSettlement } from './run-commands.ts';
import { runContextOf } from './run-context.ts';
import { decideOnRun, noSuchRun } from './run-decisions.ts';
import { RunEventSchema, runEventSchemaOf, type IsDeclared, type RecordedRunEvent } from './run-events.ts';
import { evolveRun, type RunStreamState } from './run-state.ts';

type RunReason = 'not_found' | 'conflict' | 'cancelled' | 'unavailable';

export type RunDecider = Decider<RunStreamState, RunCommand, RecordedRunEvent, RunReason>;

interface RunAsRead {
  readonly state: RunStreamState;
  readonly version: number;
}

interface CommandAsRead {
  readonly readAt: number;
  readonly command: RunCommand;
}

export type RunDeciderAsRead = Decider<RunAsRead, CommandAsRead, RecordedRunEvent, RunReason>;

export interface RunDeciders {
  readonly decider: RunDecider;
  readonly asRead: RunDeciderAsRead;
}

const changedSinceRead = new Conflict({
  detail: 'The run changed since it was read, so it is read again',
  kind: 'concurrent_change',
});

export function isChangedSinceRead(error: unknown): boolean {
  return Equal.equals(error, changedSinceRead);
}

function decidersOver(eventSchema: typeof RunEventSchema, admits: AdmitsFact): RunDeciders {
  const decide = (command: RunCommand, state: RunStreamState) => decideOnRun(command, state, admits);
  return {
    decider: { initialState: undefined, evolve: evolveRun, decide, context: runContextOf, eventSchema },
    asRead: {
      initialState: { state: undefined, version: 0 },
      evolve: ({ state, version }, event) => ({ state: evolveRun(state, event), version: version + 1 }),
      decide: ({ readAt, command }, { state, version }) =>
        readAt === version ? decide(command, state) : Result.fail(changedSinceRead),
      context: ({ command }, { state }) => runContextOf(command, state),
      eventSchema,
    },
  };
}

export function runDecidersOf(isDeclared: IsDeclared, admits: AdmitsFact): RunDeciders {
  return decidersOver(runEventSchemaOf(isDeclared), admits);
}

function knowsNoWork(): boolean {
  return false;
}

const readingAnyWork = decidersOver(RunEventSchema, knowsNoWork);

export const runDecider: RunDecider = readingAnyWork.decider;

export const runDeciderAsRead: RunDeciderAsRead = readingAnyWork.asRead;

export type SettledOn = (
  stream: string,
  command: RunSettlement,
  lineage: Lineage | undefined,
) => Effect.Effect<StreamState<RunStreamState>, Rejection<RunReason>>;

export function settledOnLatest(ledger: StreamWriter): SettledOn {
  return (stream, command, lineage) => ledger.execute(stream, runDecider, command, lineage);
}

export function settledOnRead(ledger: StreamWriter, readAt: number): SettledOn {
  return (stream, command, lineage) =>
    Effect.map(ledger.execute(stream, runDeciderAsRead, { readAt, command }, lineage), ({ state, version }) => ({
      state: state.state,
      version,
    }));
}

export function decidedOnNoRun<State, Command>(
  decider: Decider<State, Command, RecordedRunEvent, RunReason>,
  command: Command,
): Effect.Effect<never, Rejection<RunReason>> {
  return Effect.andThen(Effect.fromResult(decider.decide(command, decider.initialState)), Effect.die(noSuchRun));
}

export type RunPlacing = Pick<LedgerPorts, 'holderOfStream'>;

export interface RunInAPlaybook extends PlaybookAddress {
  readonly id: string;
}

export function runStreamIn(ledger: RunPlacing, run: RunInAPlaybook): Effect.Effect<string | undefined> {
  const name = runStreamNameOf(run.id);
  return Effect.map(ledger.holderOfStream({ playbookKey: streamPrefixOfPlaybook(run), stream: name }), (key) =>
    key === undefined ? undefined : `${key}${name}`,
  );
}

function definitionOfRun(id: string): Effect.Effect<string | undefined, never, PlaybookReader> {
  return PlaybookReader.use((reader) => reader.definitionHolding(runStreamNameOf(id)));
}

export interface RunPlace {
  readonly definition: string;
  readonly stream: string;
}

function runPlaceIn(definition: string, id: string): Effect.Effect<RunPlace, never, PlaybookContext> {
  return Effect.map(PlaybookContext, ({ org }) => ({
    definition,
    stream: `${streamPrefixOfDefinition({ org, definition })}${runStreamNameOf(id)}`,
  }));
}

export const placeOfRun = Effect.fnUntraced(function* (id: string) {
  const definition = yield* definitionOfRun(id);
  return definition === undefined ? yield* noSuchRun : yield* runPlaceIn(definition, id);
});

export const placeToStart = Effect.fnUntraced(function* (id: string, definition: string) {
  const placed = yield* definitionOfRun(id);
  return yield* runPlaceIn(placed ?? definition, id);
});

export function readerAt({ definition }: RunPlace): Effect.Effect<StreamReader & StreamAges, never, PlaybookReader> {
  return PlaybookReader.use((reader) => Effect.succeed(reader.ofDefinition(definition)));
}

export function writerAt({ definition }: RunPlace): Effect.Effect<StreamWriter, never, PlaybookWriter> {
  return PlaybookWriter.use((writer) => Effect.succeed(writer.ofDefinition(definition)));
}
