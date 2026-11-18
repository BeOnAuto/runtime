import {
  playbookPayloadReader,
  type PlaybookReader,
  type PlaybookWriter,
  type StreamReader,
  type Conflict,
  type Lineage,
  type PlaybookContext,
  type RecordedCaller,
  type Unavailable,
  runStreamNameOf,
} from '@on.auto/operations';
import { payloadMembers, type Payload, type PayloadArm, type PayloadReader } from '@on.auto/operations/payloads';
import { DateTime, Effect, Option, Struct, type Schema } from 'effect';

import { comparedWithoutItsValue, keptToCompare, type ValuesRead } from '../payloads/payload-comparisons.ts';
import { payloadWritten, type PayloadWritten } from '../payloads/payload-writing.ts';
import { valuesReadFor } from '../payloads/run-payloads.ts';
import type { AnswerFact, GivenAnswer, RunAnswer, RunCommand } from '../runs/run-commands.ts';
import { runDecider, placeOfRun, readerAt, writerAt, decidedOnNoRun } from '../runs/run-decider.ts';
import type { AnswerBeside } from '../runs/run-events.ts';
import { startedRunOf, type RecordedRunState } from '../runs/run-state.ts';

export interface AnswerPayloads<Services> {
  readonly written: (payload: Payload<Schema.Json>) => Effect.Effect<PayloadWritten, Unavailable, Services>;
  readonly reader: Effect.Effect<PayloadReader, never, Services>;
}

const nothingRead: ValuesRead = new Map();

function takenComparedWith<Services>(
  taken: Payload<Schema.Json>,
  offered: Schema.Json,
  { reader }: AnswerPayloads<Services>,
): Effect.Effect<ValuesRead, Unavailable | Conflict, Services> {
  const kept = keptToCompare(taken, { inline: offered });
  return kept.length === 0 ? Effect.succeed(nothingRead) : Effect.flatMap(reader, (read) => valuesReadFor(kept, read));
}

function keptAs(given: GivenAnswer, by: RecordedCaller, payload: Payload<Schema.Json>): AnswerFact {
  if ('inline' in payload) {
    return { ...given, answered_by: by };
  }
  const beside: Omit<AnswerBeside, 'answered_by'> = Struct.omit(given, ['answer']);
  const arm: PayloadArm<'answer', Schema.Json> = payloadMembers('answer', payload);
  return { ...arm, ...beside, answered_by: by };
}

export function answerCommandOf<Services>(
  given: GivenAnswer,
  by: RecordedCaller,
  recorded: RecordedRunState | undefined,
  payloads: AnswerPayloads<Services>,
): Effect.Effect<RunAnswer, Unavailable | Conflict, Services> {
  const taken = recorded?.answer ?? null;
  return Effect.gen(function* () {
    if (taken !== null) {
      const valuesRead = yield* takenComparedWith(taken.answer, given.answer, payloads);
      return { type: 'answer', answer: { ...given, answered_by: by }, valuesRead } satisfies RunAnswer;
    }
    const { payload } = yield* payloads.written({ inline: given.answer });
    return { type: 'answer', answer: keptAs(given, by, payload) } satisfies RunAnswer;
  });
}

type InThePlaybook = PlaybookReader | PlaybookWriter | PlaybookContext;

export type AnswerRun = (
  id: string,
  answer: GivenAnswer,
  by: RecordedCaller,
  lineage: Lineage,
) => Effect.Effect<void, Conflict | Unavailable, InThePlaybook>;

const readOfTheTaken = Effect.fnUntraced(function* (
  reader: StreamReader,
  stream: string,
  offered: Payload<Schema.Json>,
  inHand: ValuesRead,
) {
  const { state } = yield* reader.load(stream, runDecider);
  const taken = Option.getOrThrow(
    Option.fromNullishOr(startedRunOf(state)).pipe(Option.flatMapNullishOr(({ answer }) => answer)),
  );
  const kept = keptToCompare(taken.answer, offered).filter(({ sha256 }) => !inHand.has(sha256));
  return new Map([...inHand, ...(yield* valuesReadFor(kept, yield* playbookPayloadReader))]);
});

export const playbookBoundAnswerer: AnswerRun = (id, given, by, lineage) =>
  Effect.gen(function* () {
    const runId = id.toLowerCase();
    const stream = runStreamNameOf(runId);
    const place = yield* Effect.option(placeOfRun(runId));
    const { payload, inHand } = yield* payloadWritten({ inline: given.answer });
    const at = DateTime.formatIso(yield* DateTime.now);
    const answer = keptAs(given, by, payload);
    const commandOf = (valuesRead: ValuesRead) =>
      ({ type: 'answer', answer, valuesRead, runId, by: by.id, at }) satisfies RunCommand;
    if (Option.isNone(place)) {
      return yield* decidedOnNoRun(runDecider, commandOf(inHand)).pipe(
        Effect.catchTags({ not_found: Effect.die, cancelled: Effect.die }),
      );
    }
    const writer = yield* writerAt(place.value);
    const reader = yield* readerAt(place.value);
    const answered = (valuesRead: ValuesRead) => writer.execute(stream, runDecider, commandOf(valuesRead), lineage);
    return yield* answered(inHand).pipe(
      Effect.catchIf(
        (refused: unknown) => refused === comparedWithoutItsValue,
        () => Effect.flatMap(readOfTheTaken(reader, stream, payload, inHand), answered),
      ),
      Effect.catchTags({ not_found: Effect.die, cancelled: Effect.die }),
      Effect.asVoid,
    );
  });
