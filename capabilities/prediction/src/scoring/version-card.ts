import { Buffer } from 'node:buffer';

import { textToKeep, type PlaybookAddress, type RecordedCaller, type RecordedContent } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { BuildState } from '../builds/build-state.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import type { BuildWorkOf } from '../facts/build-facts.ts';
import type { Card } from '../facts/model-facts.ts';
import { featureNamesOf } from './scoring-inputs.ts';

export interface TrainerAnswer {
  readonly candidates: readonly string[];
  readonly by: RecordedCaller;
  readonly recipe?: string;
  readonly limitations?: string;
}

type Built = Omit<Card, 'version'>;

export const mostCardBytes = 4096;

function kept(
  content: Pick<RecordedContent, 'put'>,
  playbook: PlaybookAddress,
  text: string | undefined,
): Effect.Effect<{ readonly sha256: string; readonly bytes: number } | undefined> {
  return text === undefined ? Effect.undefined : Effect.orDie(content.put(playbook, textToKeep(text, 'text/plain')));
}

function baselinesOf({ baselines }: BuildState): Card['baselines'] {
  return [...baselines.values()].map((fact) =>
    fact.type === 'baseline_scored'
      ? {
          baseline: fact.data.baseline,
          scores: fact.data.scores,
          coverage: fact.data.coverage,
          series_walked: fact.data.series_walked,
        }
      : { baseline: fact.data.baseline, series_walked: 0 },
  );
}

function boundedCard(content: Pick<RecordedContent, 'put'>, playbook: PlaybookAddress, card: Built) {
  if (Buffer.byteLength(JSON.stringify(card), 'utf8') <= mostCardBytes) {
    return Effect.succeed(card);
  }
  const { features, given, ...rest } = card;
  const columns = JSON.stringify({ features, given });
  return Effect.map(
    Effect.orDie(content.put(playbook, textToKeep(columns, 'application/json'))),
    ({ sha256, bytes }) => ({
      ...rest,
      features_sha256: sha256,
      features_bytes: bytes,
    }),
  );
}

export interface Winning {
  readonly build: BuildState;
  readonly document: PredictionFunctionDefinitionDocument;
  readonly answer: TrainerAnswer;
  readonly winner: BuildWorkOf<'candidate_scored'>['data'];
}

function datasetOf(build: BuildState): Card['dataset'] {
  const assembled = Option.getOrThrow(Option.fromNullishOr(build.assembled));
  return {
    data_sha256: assembled.data_sha256,
    training_sha256: assembled.training_sha256,
    scoring_sha256: assembled.scoring_sha256,
    rows: assembled.rows,
    series: assembled.series,
    series_left_out: assembled.series_left_out,
    first_period: assembled.first_period,
    last_period: assembled.last_period,
    window: assembled.window,
    holdout: assembled.holdout,
    checkpoint: assembled.checkpoint,
  };
}

function keptWinner(content: RecordedContent, { address }: BuildState, sha256: string): Effect.Effect<void> {
  const { org, playbook, id } = address;
  return Effect.gen(function* () {
    const staged = Option.getOrThrow(Option.fromNullishOr(yield* content.staged({ org, playbook }, id, sha256)));
    yield* Effect.orDie(
      content.put(
        { org, playbook },
        { stream: staged.stream, mediaType: 'application/octet-stream', expected: { sha256 } },
      ),
    );
  });
}

export function versionCardOf(
  content: RecordedContent,
  { build, document, answer, winner }: Winning,
): Effect.Effect<Built> {
  const { org, playbook, id } = build.address;
  const address = { org, playbook };
  return Effect.gen(function* () {
    const uploaded = Option.getOrThrow(
      Option.fromNullishOr(build.uploads.find(({ sha256 }) => sha256 === winner.sha256)),
    );
    yield* keptWinner(content, build, winner.sha256);
    const recipe = yield* kept(content, address, answer.recipe);
    const limitations = yield* kept(content, address, answer.limitations);
    const card: Built = {
      build: id,
      trained_by: answer.by,
      dataset: datasetOf(build),
      file: { sha256: uploaded.sha256, bytes: uploaded.bytes, opset: uploaded.opset },
      inputs: uploaded.inputs,
      features: featureNamesOf(document),
      given: document.data.given,
      scores: winner.scores,
      coverage: winner.coverage,
      against: winner.against,
      baselines: baselinesOf(build),
      rule: document.evaluation.activate === 'automatic' ? 'automatic' : 'approved',
      ...(recipe === undefined ? {} : { recipe_sha256: recipe.sha256, recipe_bytes: recipe.bytes }),
      ...(limitations === undefined
        ? {}
        : { limitations_sha256: limitations.sha256, limitations_bytes: limitations.bytes }),
    };
    return yield* boundedCard(content, address, card);
  });
}
