import { InvalidInput, type Conflict, type Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import { documentOfBuild } from '../builds/build-document.ts';
import type { BuildState } from '../builds/build-state.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { listedFormats } from '../runtimes/format-words.ts';
import {
  fedShapeOf,
  formatsOfferedFor,
  licensedFor,
  type ExecutedFormat,
  type LicensedRuntimes,
  type OfferedFormats,
  type UnlicensedFormat,
  executesFormat,
  refusedAs,
} from '../runtimes/model-runtimes.ts';
import type { Checking } from './candidate-checks.ts';

function refusedAtFormat(detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer: '/format', detail }] });
}

const noneExecuted = 'No model runtime this server has installed executes a candidate for this function';

function refusedAsUnlicensed(
  licensed: LicensedRuntimes,
  { format, feature }: UnlicensedFormat,
): Effect.Effect<never, Conflict | Unavailable> {
  return refusedAs(licensed, feature, executesFormat(format));
}

function chosenUnnamed(
  licensed: LicensedRuntimes,
  { accepted, unlicensed }: OfferedFormats,
): Effect.Effect<ExecutedFormat, Conflict | InvalidInput | Unavailable> {
  const [only, ...others] = accepted;
  const [refused] = unlicensed;
  if (only !== undefined) {
    return others.length === 0
      ? Effect.succeed(only)
      : Effect.fail(refusedAtFormat(`Name the format of the candidate, one of ${listedFormats(formatsOf(accepted))}`));
  }
  return refused === undefined ? Effect.fail(refusedAtFormat(noneExecuted)) : refusedAsUnlicensed(licensed, refused);
}

function formatsOf(executed: readonly ExecutedFormat[]): readonly string[] {
  return executed.map(({ format }) => format);
}

function formatChosen(
  licensed: LicensedRuntimes,
  offered: OfferedFormats,
  named: string | undefined,
): Effect.Effect<ExecutedFormat, Conflict | InvalidInput | Unavailable> {
  if (named === undefined) {
    return chosenUnnamed(licensed, offered);
  }
  const { accepted, unlicensed } = offered;
  const chosen = accepted.find(({ format }) => format === named);
  const refused = unlicensed.find(({ format }) => format === named);
  if (chosen !== undefined) {
    return Effect.succeed(chosen);
  }
  if (refused !== undefined) {
    return refusedAsUnlicensed(licensed, refused);
  }
  return Effect.fail(
    refusedAtFormat(
      accepted.length === 0
        ? noneExecuted
        : `The format ${named} is not one this server executes for this function, which takes ${listedFormats(formatsOf(accepted))}`,
    ),
  );
}

export function checkingOf(
  ports: PredictionPorts,
  build: BuildState,
  named: string | undefined,
): Effect.Effect<Checking, Conflict | InvalidInput | Unavailable> {
  const licensed = licensedFor(ports, build.address.org);
  return Effect.gen(function* () {
    const document = yield* documentOfBuild(ports.ledger, build);
    const offered = yield* formatsOfferedFor(licensed, fedShapeOf(document));
    const chosen = yield* formatChosen(licensed, offered, named);
    return { build, document, chosen };
  });
}
