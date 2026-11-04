import {
  succeededRunsPageOf,
  type NamedDefinition,
  type SucceededRun,
  type SucceededRunsReader,
} from '@on.auto/definitions';
import type { PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

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

export interface RunsAsked {
  readonly place: PlaybookAddress;
  readonly definition: NamedDefinition;
  readonly start: string;
  readonly since: number | undefined;
  readonly words: readonly string[];
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

function answeredWith(answering: Answering, run: SucceededRun, asked: RunsAsked): Reading {
  const passed = throughTo(answering, run.started_at, answering.record.examined + 1);
  if (!holdsEveryWord(JSON.stringify(run.output), asked.words)) {
    return fits(passed, false) ? readingOn(passed) : endedWith(answering, true);
  }
  const whole = withEntry(answering, wholeEntryOf(run), passed.record);
  if (fits(whole, false)) {
    return readingOn(whole);
  }
  const sized = withEntry(answering, sizedEntryOf(run), passed.record);
  return endedWith(fits(sized, true) ? sized : answering, true);
}

function readOf(answering: Answering, run: SucceededRun, asked: RunsAsked): Reading {
  return asked.since !== undefined && Date.parse(run.started_at) < asked.since
    ? endedWith(answering, false)
    : answeredWith(answering, run, asked);
}

function readThrough(answering: Answering, runs: readonly SucceededRun[], asked: RunsAsked): Reading {
  let reading = readingOn(answering);
  for (const run of runs) {
    if (reading.ended) {
      return reading;
    }
    reading = readOf(reading.answering, run, asked);
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

export function runsRead(reader: SucceededRunsReader, asked: RunsAsked, mostPages: number): Effect.Effect<RunsAnswer> {
  const { place, definition, since } = asked;
  const bounded = since === undefined ? {} : { since: new Date(since).toISOString() };
  return Effect.gen(function* () {
    let answering = nothingAnswered;
    let after = asked.start;
    for (let read = 0; read < mostPages; read += 1) {
      const page = yield* succeededRunsPageOf(reader, { place, definition, after, ...bounded });
      const walked = readThrough(answering, page.runs, asked);
      const reached = walked.ended ? walked : reachedOf(walked.answering, page.reached);
      if (reached.ended) {
        return reached.answer;
      }
      if (page.next === undefined) {
        return answerOf(reached.answering, false);
      }
      answering = reached.answering;
      after = page.next;
    }
    return answerOf(answering, true);
  });
}
