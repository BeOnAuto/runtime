import {
  checkedInput,
  functionResourceLabels,
  runStartCursorIn,
  type CapabilityAnswer,
  type RunContext,
  type SucceededRunsReader,
} from '@on.auto/definitions';
import { renderClock, type RenderClock } from '@on.auto/definitions/template';
import { momentVariables, renderedText, unrenderableFor, unworkable } from '@on.auto/definitions/tool-blocks';
import type { Conflict, InvalidInput } from '@on.auto/operations';
import { Clock, Effect, Result, type Schema } from 'effect';

import type { RunsLookupDocument, WrittenText } from '../document/lookup-document.ts';
import { sinceMoment, sinceProblem, wordsProblem } from '../document/runs-bounds.ts';
import { runsRead } from './runs-read.ts';
import { wordsIn } from './word-matching.ts';

interface RunsPorts {
  readonly runs: SucceededRunsReader;
  readonly mostPagesRead: number;
}

type Variables = Readonly<Record<string, Schema.Json>>;

type RenderedProblem = (text: string) => string | undefined;

function fieldOf({ pointer }: WrittenText): string {
  return pointer.slice(1).replaceAll('/', '.');
}

function renderedField(
  written: WrittenText | undefined,
  variables: Variables,
  clock: RenderClock,
  problem: RenderedProblem,
): Effect.Effect<string | undefined, Conflict | InvalidInput> {
  if (written === undefined) {
    return Effect.undefined;
  }
  return Result.match(renderedText(written.template, variables, Number.POSITIVE_INFINITY, clock), {
    onSuccess: (text) => {
      const found = problem(text);
      return found === undefined ? Effect.succeed(text) : Effect.fail(unworkable(written.pointer, found));
    },
    onFailure: (failure) =>
      Effect.fail(
        failure.reason === 'not_text'
          ? unworkable(
              written.pointer,
              `${fieldOf(written)} renders a value that is not text; write | json after a list or an object it reads`,
            )
          : unrenderableFor(fieldOf(written), failure),
      ),
  });
}

export const runsRun = (ports: RunsPorts) =>
  Effect.fnUntraced(function* (document: RunsLookupDocument, input: Schema.Json, context: RunContext) {
    const admitted = yield* checkedInput(input, document.input.schema, functionResourceLabels.lookup.singular);
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    const variables = momentVariables(admitted, at);
    const clock = yield* renderClock;
    const { type, name, words, since } = document.runs;
    const rendered = {
      words: yield* renderedField(words, variables, clock, wordsProblem),
      since: yield* renderedField(since, variables, clock, sinceProblem),
    };
    const place = { org: context.org, playbook: context.playbook };
    const asked = {
      place,
      definition: { type, name },
      start: yield* runStartCursorIn(ports.runs, { ...place, id: context.id }),
      since: rendered.since === undefined ? undefined : sinceMoment(rendered.since),
      words: wordsIn(rendered.words ?? ''),
    };
    const answer: CapabilityAnswer = yield* runsRead(ports.runs, asked, ports.mostPagesRead);
    return answer;
  });
