import {
  payloadAsRead,
  payloadsKeptIn,
  succeededRunsPageOf,
  type NamedDefinition,
  type SucceededRun,
  type SucceededRunsReader,
} from '@on.auto/definitions';
import { Unavailable, type PlaybookAddress } from '@on.auto/operations';
import type { PayloadReader } from '@on.auto/operations/payloads';
import { jsonBytesOf } from '@on.auto/workflow-engine/dsl';
import { Clock, Effect, type Schema } from 'effect';

import {
  answerOf,
  fits,
  nothingAnswered,
  sizedEntryOf,
  wholeEntryOf,
  withEntry,
  type Answering,
  type RunsAnswer,
} from './runs-answer.ts';
import { holdsEveryWord } from './word-matching.ts';

export const mostPagesReadInARun = 10;

const mostOutputsReadInARun = 100;

const mostOutputBytesReadInARun = 8 * 1024 * 1024;

const outputsReadAtOnce = 6;

const mostScanMs = 15_000;

const outputsNotRead = new Unavailable({
  detail:
    "The outputs of this function's runs, which the playbook keeps outside them, could not be read just now, so the runs were not looked through; ask again in a moment",
});

export interface RunsAsked {
  readonly place: PlaybookAddress;
  readonly definition: NamedDefinition;
  readonly start: string;
  readonly since: number | undefined;
  readonly words: readonly string[];
}

type OutputOfARun =
  | { readonly value: Schema.Json }
  | { readonly lost: 'missing' | 'erased'; readonly bytes: number }
  | { readonly stopped: 'over_the_bound' };

type OutputsRead = ReadonlyMap<string, OutputOfARun>;

type OutputRead = readonly [string, OutputOfARun];

interface ReadsLeft {
  readonly reads: number;
  readonly bytes: number;
}

type Reading =
  | { readonly ended: false; readonly answering: Answering }
  | { readonly ended: true; readonly answer: RunsAnswer };

function readingOn(answering: Answering): Reading {
  return { ended: false, answering };
}

function endedWith(answering: Answering, more: boolean): Reading {
  return { ended: true, answer: answerOf(answering, more) };
}

function throughTo(answering: Answering, through: string, examined = answering.record.examined): Answering {
  return { ...answering, record: { examined, through } };
}

function isBefore(run: SucceededRun, since: number | undefined): boolean {
  return since !== undefined && Date.parse(run.started_at) < since;
}

function outputOf({ run_id: id, output }: SucceededRun, read: OutputsRead): OutputOfARun {
  return 'inline' in output ? { value: output.inline } : (read.get(id) ?? { stopped: 'over_the_bound' });
}

type OutputToShow = Exclude<OutputOfARun, { readonly stopped: unknown }>;

function bytesOfTheOutput(output: OutputToShow): number {
  return 'value' in output ? jsonBytesOf(output.value) : output.bytes;
}

function shownOf(answering: Answering, passed: Answering, run: SucceededRun, output: OutputToShow): Reading {
  if ('value' in output) {
    const whole = withEntry(answering, wholeEntryOf(run, output.value), passed.record);
    if (fits(whole, false)) {
      return readingOn(whole);
    }
  }
  const sized = withEntry(answering, sizedEntryOf(run, bytesOfTheOutput(output)), passed.record);
  return endedWith(fits(sized, true) ? sized : answering, true);
}

function holdsTheWords(output: OutputToShow, { words }: RunsAsked): boolean {
  return 'value' in output ? holdsEveryWord(JSON.stringify(output.value), words) : words.length === 0;
}

function answeredWith(answering: Answering, run: SucceededRun, output: OutputOfARun, asked: RunsAsked): Reading {
  if ('stopped' in output) {
    return endedWith(answering, true);
  }
  const passed = throughTo(answering, run.started_at, answering.record.examined + 1);
  if (!holdsTheWords(output, asked)) {
    return fits(passed, false) ? readingOn(passed) : endedWith(answering, true);
  }
  return shownOf(answering, passed, run, output);
}

function readOf(answering: Answering, run: SucceededRun, read: OutputsRead, asked: RunsAsked): Reading {
  return isBefore(run, asked.since)
    ? endedWith(answering, false)
    : answeredWith(answering, run, outputOf(run, read), asked);
}

function readThrough(
  answering: Answering,
  runs: readonly SucceededRun[],
  read: OutputsRead,
  asked: RunsAsked,
): Reading {
  let reading = readingOn(answering);
  for (const run of runs) {
    if (reading.ended) {
      return reading;
    }
    reading = readOf(reading.answering, run, read, asked);
  }
  return reading;
}

function reachedOf(answering: Answering, reached: string | undefined): Reading {
  if (reached === undefined) {
    return readingOn(answering);
  }
  const further = throughTo(answering, reached);
  return fits(further, false) ? readingOn(further) : endedWith(answering, true);
}

interface KeptToRead {
  readonly runs: readonly SucceededRun[];
  readonly left: ReadsLeft;
}

function keptToRead(runs: readonly SucceededRun[], { since }: RunsAsked, left: ReadsLeft): KeptToRead {
  const kept: SucceededRun[] = [];
  let remaining = left;
  for (const run of runs) {
    if (isBefore(run, since)) {
      break;
    }
    if ('kept' in run.output) {
      const { bytes } = run.output.kept;
      if (remaining.reads < 1 || remaining.bytes < bytes) {
        break;
      }
      remaining = { reads: remaining.reads - 1, bytes: remaining.bytes - bytes };
      kept.push(run);
    }
  }
  return { runs: kept, left: remaining };
}

function outputRead(run: SucceededRun, payloads: PayloadReader): Effect.Effect<OutputRead, Unavailable> {
  return Effect.flatMap(payloadAsRead(run.output, payloads), (read): Effect.Effect<OutputRead, Unavailable> => {
    if ('read' in read) {
      return Effect.succeed([run.run_id, { value: read.read }]);
    }
    return read.unread === 'unavailable'
      ? Effect.fail(outputsNotRead)
      : Effect.succeed([run.run_id, { lost: read.unread, bytes: read.kept.bytes }]);
  });
}

function outputsReadOf(
  kept: readonly SucceededRun[],
  payloads: PayloadReader,
): Effect.Effect<OutputsRead, Unavailable> {
  return Effect.map(
    Effect.forEach(kept, (run) => outputRead(run, payloads), { concurrency: outputsReadAtOnce }),
    (read: readonly (readonly [string, OutputOfARun])[]) => new Map(read),
  );
}

interface OutputsReadWithin {
  readonly read: OutputsRead;
  readonly msLeft: number;
}

const nothingKeptRead: OutputsRead = new Map();

function outputsReadWithin(
  kept: readonly SucceededRun[],
  payloads: PayloadReader,
  msLeft: number,
): Effect.Effect<OutputsReadWithin, Unavailable> {
  if (kept.length === 0) {
    return Effect.succeed({ read: nothingKeptRead, msLeft });
  }
  return Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis;
    const read = yield* outputsReadOf(kept, payloads).pipe(
      Effect.timeoutOrElse({ duration: Math.max(msLeft, 0), orElse: () => Effect.fail(outputsNotRead) }),
    );
    return { read, msLeft: msLeft - ((yield* Clock.currentTimeMillis) - startedAt) };
  });
}

export function runsRead(
  reader: SucceededRunsReader,
  asked: RunsAsked,
  mostPages: number,
  mostMs = mostScanMs,
): Effect.Effect<RunsAnswer, Unavailable> {
  const { place, definition, since } = asked;
  const bounded = since === undefined ? {} : { since: new Date(since).toISOString() };
  const payloads = payloadsKeptIn(reader.content, place);
  return Effect.gen(function* () {
    let answering = nothingAnswered;
    let after = asked.start;
    let left: ReadsLeft = { reads: mostOutputsReadInARun, bytes: mostOutputBytesReadInARun };
    let msLeft = mostMs;
    for (let read = 0; read < mostPages; read += 1) {
      const page = yield* succeededRunsPageOf(reader, { place, definition, after, ...bounded });
      const kept = keptToRead(page.runs, asked, left);
      const outputs = yield* outputsReadWithin(kept.runs, payloads, msLeft);
      const walked = readThrough(answering, page.runs, outputs.read, asked);
      const reached = walked.ended ? walked : reachedOf(walked.answering, page.reached);
      if (reached.ended) {
        return reached.answer;
      }
      if (page.next === undefined) {
        return answerOf(reached.answering, false);
      }
      answering = reached.answering;
      after = page.next;
      left = kept.left;
      msLeft = outputs.msLeft;
    }
    return answerOf(answering, true);
  });
}
