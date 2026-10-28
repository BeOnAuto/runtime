import { workRecorder, type CapabilityAnswer, type CapabilityRejection, type RunContext } from '@on.auto/definitions';
import { Clock, Effect } from 'effect';

import type { PredictionPorts } from '../capability/prediction-ports.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { buildRunFacts } from '../facts/prediction-facts.ts';
import { claimable, claimedBuild, type Claiming } from '../models/build-claims.ts';
import { keptBrief } from './build-brief.ts';
import { assembledOf, buildFilesOf } from './build-files.ts';
import { buildRefusal } from './build-refusals.ts';
import { buildRecordOf } from './build-request.ts';

function claimingOf(ports: PredictionPorts, context: RunContext, now: number): Claiming {
  const { org, playbook, id, definition } = context;
  return {
    ports,
    playbook: { org, playbook },
    lineage: { causationId: context.lineage.startId, correlationId: context.lineage.correlationId },
    command: {
      at: new Date(now).toISOString(),
      by: context.caller.id,
      name: definition.name,
      definitionVersion: definition.version,
      build: id,
      now,
      perDay: ports.bounds.buildsPerDay,
    },
  };
}

export function buildRun(
  ports: PredictionPorts,
  document: PredictionFunctionDefinitionDocument,
  context: RunContext,
): Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  const { org, playbook: playbookId, id, definition } = context;
  const playbook = { org, playbook: playbookId };
  const record = workRecorder(ports.ledger, buildRunFacts);
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const claiming = claimingOf(ports, context, now);
    const { lineage } = claiming;
    const refusal = yield* buildRefusal(ports, { playbook, inbox: document.source.through === undefined });
    if (refusal !== undefined) {
      return yield* Effect.fail(refusal);
    }
    yield* claimable(claiming);
    const files = yield* buildFilesOf(ports, playbook, document, now);
    const assembled = assembledOf(files);
    const brief = yield* keptBrief(ports.ledger.content, playbook, document, {
      name: definition.name,
      files,
      runtimes: ports.runtimes,
    });
    yield* claimedBuild(claiming);
    yield* record(
      { org, playbook: playbookId, id },
      { type: 'work', fact: { type: 'dataset_assembled', data: assembled } },
      lineage,
    );
    return {
      finishesLater: true,
      record: buildRecordOf({
        run: { org, playbook: playbookId, id },
        name: definition.name,
        document,
        assembled,
        brief,
        requestedAt: now,
      }),
    };
  });
}
