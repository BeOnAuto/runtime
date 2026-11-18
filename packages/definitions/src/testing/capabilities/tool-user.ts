import { Conflict, Unavailable } from '@on.auto/operations';
import type { CallEnded, CallStarted } from '@on.auto/tool-servers';
import { Effect, Schema } from 'effect';

import {
  defineCapability,
  type CapabilityAnswer,
  type CapabilityRejection,
  type Capability,
  type RunJournal,
} from '../../index.ts';

type Ending = 'succeed' | 'unavailable' | 'conflict' | 'stall';

export interface ToolUser {
  readonly capability: Capability;
  readonly stalled: Promise<void>;
  readonly recordedLate: () => Promise<readonly boolean[]>;
  readonly startedLate: () => Promise<readonly (number | undefined)[]>;
}

export function startOfCall(number: number, reads = false): CallStarted {
  return {
    call_id: `toolu_${number}`,
    server: 'graph',
    tool: 'search',
    arguments_bytes: 2,
    arguments_sha256: 'a'.repeat(64),
    ...(reads ? { read_only: true } : {}),
  };
}

export function answerOfCall(number: number): CallEnded {
  return {
    type: 'tool_call_answered',
    data: {
      is_error: false,
      result_bytes: 2,
      result_sha256: 'b'.repeat(64),
      duration_ms: 5,
      jsonrpc_id: number,
    },
  };
}

const decodeInput = Schema.decodeUnknownSync(
  Schema.Struct({
    calls: Schema.Int,
    ending: Schema.optionalKey(Schema.Literals(['succeed', 'unavailable', 'conflict', 'stall'])),
    failing: Schema.optionalKey(Schema.Boolean),
    reads: Schema.optionalKey(Schema.Boolean),
    bulk: Schema.optionalKey(Schema.Int),
  }),
);

export function failureOfCall(number: number): CallEnded {
  return { type: 'tool_call_failed', data: { because: 'timed_out', duration_ms: 30_000, jsonrpc_id: number } };
}

function numbersUpTo(count: number): readonly number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function everyStart(count: number, journal: RunJournal, reads: boolean) {
  return Effect.forEach(
    numbersUpTo(count),
    (number) => Effect.map(journal.started(startOfCall(number, reads)), (assigned) => assigned !== undefined),
    { concurrency: 'unbounded' },
  );
}

function everyAnswer(count: number, journal: RunJournal, failing: boolean) {
  const endOf = failing ? failureOfCall : answerOfCall;
  return Effect.forEach(numbersUpTo(count), (number) => journal.ended(number, endOf(number)), {
    concurrency: 'unbounded',
  });
}

function outputOf(recorded: readonly boolean[], bulk: number | undefined): Schema.JsonObject {
  return bulk === undefined ? { recorded: [...recorded] } : { recorded: [...recorded], page: 'x'.repeat(bulk) };
}

const endings: Readonly<
  Record<
    Exclude<Ending, 'stall'>,
    (recorded: readonly boolean[], bulk: number | undefined) => Effect.Effect<CapabilityAnswer, CapabilityRejection>
  >
> = {
  succeed: (recorded, bulk) => Effect.succeed({ output: outputOf(recorded, bulk), record: {} }),
  unavailable: () => Effect.fail(new Unavailable({ detail: 'The tools stopped answering' })),
  conflict: () => Effect.fail(new Conflict({ detail: 'The tools cannot run as written' })),
};

export function toolUser(): ToolUser {
  const journals: RunJournal[] = [];
  const stalling = Promise.withResolvers<void>();
  const capability = defineCapability({
    type: 'tool-user',
    title: 'Tool user',
    guide: { name: 'tool-user' },
    noun: { one: 'tool user', other: 'tool users' },
    describeOutput: () => 'It called its tools.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed(source),
    summarize: () => ({}),
    run: (_document, input, { journal }) =>
      Effect.gen(function* () {
        journals.push(journal);
        const { calls, ending = 'succeed', failing = false, reads = false, bulk } = decodeInput(input);
        const started = yield* everyStart(calls, journal, reads);
        if (ending === 'stall') {
          stalling.resolve();
          return yield* Effect.never;
        }
        const answered = yield* everyAnswer(calls, journal, failing);
        return yield* endings[ending]([...started, ...answered], bulk);
      }),
    reachesOutside: true,
    mayChangeOutside: true,
    callsTools: () => true,
  });
  return {
    capability,
    stalled: stalling.promise,
    recordedLate: () => Promise.all(journals.map((journal) => Effect.runPromise(journal.ended(1, answerOfCall(1))))),
    startedLate: () => Promise.all(journals.map((journal) => Effect.runPromise(journal.started(startOfCall(9))))),
  };
}
