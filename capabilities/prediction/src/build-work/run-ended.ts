import { recordedRunIn, runCanceller } from '@on.auto/definitions';
import { Effect, Option } from 'effect';

import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { lifecycleStep } from '../shadow/model-lifecycle.ts';
import { advanced, restingUntil, type Performing, type PerformedStep } from './build-performing.ts';
import { approvalReference, childIdOf } from './child-runs.ts';

function childCancelled(performing: Performing, child: string): Effect.Effect<void> {
  const { ports, build, lineage } = performing;
  const address = { ...build.address, id: child };
  return Effect.flatMap(recordedRunIn(ports.ledger, address), (run) =>
    run?.run.status === 'started'
      ? runCanceller(ports.ledger)(
          address,
          { kind: 'parent_ended', reason: 'The build that asked for it has ended' },
          lineage,
        ).pipe(Effect.orDie, Effect.asVoid)
      : Effect.void,
  );
}

function childrenCancelled(performing: Performing): Effect.Effect<void> {
  const { row, build } = performing;
  const children = [childIdOf(build.address.id, approvalReference), ...(row.through === null ? [] : [row.through])];
  return Effect.andThen(
    Effect.forEach(children, (child) => childCancelled(performing, child)),
    restingUntil(performing, null),
  );
}

function endedWork(performing: Performing, document: PredictionFunctionDefinitionDocument): PerformedStep {
  const { ports, row, build, now } = performing;
  const { org, playbook, id } = build.address;
  if (row.staged) {
    return Effect.andThen(
      ports.ledger.content.unstage({ org, playbook }, id),
      advanced(performing, { staged: false, next_due_at: now }),
    );
  }
  return row.open ? lifecycleStep(performing, document) : childrenCancelled(performing);
}

export function afterTheRun(performing: Performing, document: PredictionFunctionDefinitionDocument): PerformedStep {
  const { scoring_sha256: scoring } = Option.getOrThrow(Option.fromNullishOr(performing.build.assembled));
  return Effect.andThen(performing.ports.caches.parsed.released(scoring), endedWork(performing, document));
}
