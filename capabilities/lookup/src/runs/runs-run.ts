import {
  checkedInput,
  functionResourceLabels,
  runStartCursorIn,
  type CapabilityAnswer,
  type RunContext,
  type SucceededRunsReader,
} from '@on.auto/definitions';
import { inputReadBy, renderClock, unreadAssetOf, type RenderClock } from '@on.auto/definitions/template';
import { momentVariables, renderedText, unrenderableFor, unworkable } from '@on.auto/definitions/tool-blocks';
import type { AssetHolding, Conflict, InvalidInput, PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect, Result, type Schema } from 'effect';

import type { RunsLookupDocument, WrittenText } from '../document/lookup-document.ts';
import { mostWordsCharacters, sinceForms, sinceMoment, sinceProblem, wordsProblem } from '../document/runs-bounds.ts';
import { runsRead } from './runs-read.ts';
import { wordsIn } from './word-matching.ts';

interface RunsPorts {
  readonly runs: SucceededRunsReader;
  readonly assets: AssetHolding;
  readonly mostPagesRead: number;
}

interface FieldRendering {
  readonly admitted: Schema.Json;
  readonly at: string;
  readonly clock: RenderClock;
  readonly assets: AssetHolding;
  readonly playbook: PlaybookAddress;
}

type RenderedProblem = (text: string) => string | undefined;

interface FieldRules {
  readonly problem: RenderedProblem;
  readonly verb: 'takes' | 'reads';
  readonly remedy: string;
}

const wordsRules: FieldRules = { problem: wordsProblem, verb: 'takes', remedy: 'give it a shorter text' };

const sinceRules: FieldRules = { problem: sinceProblem, verb: 'reads', remedy: `give it ${sinceForms}` };

function fieldOf({ pointer }: WrittenText): string {
  return pointer.slice(1).replaceAll('/', '.');
}

function inputReadFor(
  written: WrittenText,
  { admitted, assets, playbook }: FieldRendering,
  { verb, remedy }: FieldRules,
): Effect.Effect<Schema.Json, Conflict | InvalidInput> {
  const bound = {
    most: mostWordsCharacters,
    unit: 'characters',
    reader: `${fieldOf(written)} ${verb}`,
    remedy,
  } as const;
  return Effect.mapError(
    inputReadBy(written.template.variables, admitted, { holding: assets, playbook, bound }),
    unreadAssetOf,
  );
}

function renderedField(
  written: WrittenText | undefined,
  rendering: FieldRendering,
  rules: FieldRules,
): Effect.Effect<string | undefined, Conflict | InvalidInput> {
  if (written === undefined) {
    return Effect.undefined;
  }
  return Effect.flatMap(inputReadFor(written, rendering, rules), (read) =>
    renderedOver(written, momentVariables(read, rendering.at), rendering.clock, rules.problem),
  );
}

function renderedOver(
  written: WrittenText,
  variables: Readonly<Record<string, Schema.Json>>,
  clock: RenderClock,
  problem: RenderedProblem,
): Effect.Effect<string, Conflict | InvalidInput> {
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
    const admitted = yield* checkedInput(
      input,
      document.input.schema,
      functionResourceLabels.lookup.singular,
      'passed_whole',
    );
    const at = new Date(yield* Clock.currentTimeMillis).toISOString();
    const place = { org: context.org, playbook: context.playbook };
    const rendering = { admitted, at, clock: yield* renderClock, assets: ports.assets, playbook: place };
    const { type, name, words, since } = document.runs;
    const rendered = {
      words: yield* renderedField(words, rendering, wordsRules),
      since: yield* renderedField(since, rendering, sinceRules),
    };
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
