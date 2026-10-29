import type { ProjectedKeyedRow } from '@on.auto/operations';
import type { DueItem, DueWork } from '@on.auto/workflow-host';
import { Effect, Option } from 'effect';

import { aMinute, restingUntil, type Performing } from '../build-work/build-performing.ts';
import { afterTheRun } from '../build-work/run-ended.ts';
import { duringTheRun } from '../build-work/run-steps.ts';
import type { PredictionPorts, StartChild } from '../capability/prediction-ports.ts';
import { documentOfBuild } from './build-document.ts';
import { buildRowFrom, predictionBuildsName } from './build-rows.ts';
import { buildOf, correlationOf } from './build-state.ts';

export interface BuildsDueParts {
  readonly ports: PredictionPorts;
  readonly runs: StartChild;
}

function performedBuild({ ports, runs }: BuildsDueParts, kept: ProjectedKeyedRow, now: number): Effect.Effect<void> {
  const row = buildRowFrom(kept.row);
  const address = { org: kept.org, playbook: kept.playbook, id: kept.key };
  return Effect.gen(function* () {
    const build = Option.getOrThrow(Option.fromNullishOr(yield* buildOf(ports.ledger, address)));
    const correlationId = yield* correlationOf(ports.ledger, address);
    const performing: Performing = { ports, runs, row, build, lineage: { causationId: row.cause, correlationId }, now };
    const document = yield* documentOfBuild(ports.ledger, build);
    const step =
      build.run.run.status === 'started' ? duringTheRun(performing, document) : afterTheRun(performing, document);
    return yield* step.pipe(Effect.catchTag('unavailable', () => restingUntil(performing, now + aMinute)));
  });
}

function itemOf(parts: BuildsDueParts, kept: ProjectedKeyedRow): DueItem {
  return {
    key: `${kept.org}/${kept.playbook}/${kept.key}`,
    callsOut: false,
    perform: (now) => Effect.suspend(() => performedBuild(parts, kept, now)),
  };
}

export function buildsDue(parts: BuildsDueParts): DueWork {
  const { ledger } = parts.ports;
  return {
    name: 'the builds of prediction functions',
    due: (now, most, callsOut) =>
      callsOut
        ? Effect.succeed([])
        : Effect.map(
            ledger.readDueRows(predictionBuildsName, { column: 'next_due_at', through: now, limit: most }),
            (rows) => rows.map((kept) => itemOf(parts, kept)),
          ),
    nextDueAt: (after, callsOut = false) =>
      callsOut ? Effect.succeed(null) : ledger.nextDueOf(predictionBuildsName, 'next_due_at', after),
  };
}
