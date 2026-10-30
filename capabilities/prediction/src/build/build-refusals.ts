import { Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import { predictionBuildsName } from '../builds/build-rows.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';

export interface Asked {
  readonly playbook: PlaybookAddress;
  readonly inbox: boolean;
}

function fullForTheDeployment({ ledger, bounds }: PredictionPorts): Effect.Effect<Unavailable | undefined> {
  return Effect.map(
    ledger.readDueRows(predictionBuildsName, {
      column: 'scoring_since',
      through: Number.MAX_SAFE_INTEGER,
      limit: bounds.buildsAtOnce,
    }),
    (rows) =>
      rows.length < bounds.buildsAtOnce
        ? undefined
        : new Unavailable({
            detail: 'Every build this server may score at once is being scored; ask again once one has scored',
            kind: 'builds_full',
          }),
  );
}

function fullOfRequests(ports: PredictionPorts, { playbook, inbox }: Asked): Effect.Effect<Unavailable | undefined> {
  if (!inbox) {
    return Effect.undefined;
  }
  return Effect.map(ports.openRequests(playbook), (open) =>
    open < ports.bounds.mostOpenRequests
      ? undefined
      : new Unavailable({
          detail: `The playbook holds ${open} open requests, the most it may; one must be answered, expire or be cancelled before a build asks its trainer`,
          kind: 'requests_full',
        }),
  );
}

export function buildRefusal(ports: PredictionPorts, asked: Asked): Effect.Effect<Unavailable | undefined> {
  return Effect.gen(function* () {
    return (yield* fullForTheDeployment(ports)) ?? (yield* fullOfRequests(ports, asked));
  });
}
