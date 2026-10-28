import { InvalidInput } from '@on.auto/operations';
import type { ModelRuntime } from '@on.auto/prediction-contract';
import { Effect, Result } from 'effect';

import { documentOfBuild } from '../builds/build-document.ts';
import type { BuildState } from '../builds/build-state.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { listedFormats } from '../runtimes/format-words.ts';
import { fedShapeOf, formatsAcceptedFor, type ExecutedFormat } from '../runtimes/model-runtimes.ts';
import type { Checking } from './candidate-checks.ts';

function refusedAtFormat(detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer: '/format', detail }] });
}

const noneExecuted = 'No model runtime this server has installed executes a candidate for this function';

function formatChosen(
  runtimes: readonly ModelRuntime[],
  document: PredictionFunctionDefinitionDocument,
  named: string | undefined,
): Result.Result<ExecutedFormat, InvalidInput> {
  const accepted = formatsAcceptedFor(runtimes, fedShapeOf(document));
  const [only, ...others] = accepted;
  const formats = listedFormats(accepted.map(({ format }) => format));
  if (only === undefined) {
    return Result.fail(refusedAtFormat(noneExecuted));
  }
  if (named === undefined) {
    return others.length === 0
      ? Result.succeed(only)
      : Result.fail(refusedAtFormat(`Name the format of the candidate, one of ${formats}`));
  }
  const chosen = accepted.find(({ format }) => format === named);
  return chosen === undefined
    ? Result.fail(
        refusedAtFormat(
          `The format ${named} is not one this server executes for this function, which takes ${formats}`,
        ),
      )
    : Result.succeed(chosen);
}

export function checkingOf(
  ports: PredictionPorts,
  build: BuildState,
  named: string | undefined,
): Effect.Effect<Checking, InvalidInput> {
  return Effect.flatMap(documentOfBuild(ports.ledger, build), (document) =>
    Effect.map(Effect.fromResult(formatChosen(ports.runtimes, document, named)), (chosen) => ({
      build,
      document,
      chosen,
    })),
  );
}
