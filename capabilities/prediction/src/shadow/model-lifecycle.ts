import type { RecordedRun } from '@on.auto/definitions';
import type { RecordedCaller } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';

import { restingUntil, type Performing, type PerformedStep } from '../build-work/build-performing.ts';
import { approvalReference, childRunOf, startedChild } from '../build-work/child-runs.ts';
import type { PredictionFunctionDefinitionDocument } from '../document/prediction-document.ts';
import { executed, modelsOf } from '../models/model-commands.ts';
import { versionOfBuild, type BuiltVersion } from '../models/model-state.ts';
import { shadowStep } from './shadow-step.ts';

type Because = 'approver_rejected' | 'unanswered' | 'shadow_failed';

function activated(
  performing: Performing,
  built: BuiltVersion,
  rule: 'automatic' | 'approved',
  by: RecordedCaller | null,
) {
  return executed(performing, (asked) => ({
    ...asked,
    type: 'activate',
    definitionVersion: built.definitionVersion,
    data: {
      version: built.version,
      rule,
      build: performing.build.address.id,
      ...(by === null ? {} : { approved_by: by }),
    },
  }));
}

function refused(performing: Performing, built: BuiltVersion, because: Because, by: RecordedCaller | null) {
  return executed(performing, (asked) => ({
    ...asked,
    type: 'refuse',
    definitionVersion: built.definitionVersion,
    data: {
      version: built.version,
      because,
      build: performing.build.address.id,
      ...(by === null ? {} : { refused_by: by }),
    },
  }));
}

function approvalAsked(performing: Performing, approver: string, built: BuiltVersion) {
  const { build } = performing;
  return Effect.gen(function* () {
    const started = yield* startedChild(
      performing.runs,
      {
        build: build.address,
        reference: approvalReference,
        name: approver,
        input: { function: build.run.run.name, version: built.version, card: built.card },
        lineage: performing.lineage,
      },
      build.run,
    );
    const child = yield* childRunOf(performing.ports.ledger, build.address, approvalReference);
    return started.status === 'rejected' && child === undefined
      ? yield* refused(performing, built, 'unanswered', null)
      : yield* restingUntil(performing, null);
  });
}

const decodeDecision = Schema.decodeUnknownOption(Schema.Struct({ decision: Schema.Literals(['approve', 'reject']) }));

interface Decided {
  readonly decision: 'approve' | 'reject' | 'unanswered';
  readonly by: RecordedCaller | null;
}

function decidedIn({ run, answer }: RecordedRun): Decided {
  if (run.status !== 'succeeded' || answer === null) {
    return { decision: 'unanswered', by: null };
  }
  return Option.match(decodeDecision(answer.answer), {
    onNone: (): Decided => ({ decision: 'unanswered', by: null }),
    onSome: ({ decision }): Decided => ({ decision, by: answer.by }),
  });
}

function decided(performing: Performing, built: BuiltVersion, child: RecordedRun) {
  const { decision, by } = decidedIn(child);
  if (decision === 'approve') {
    return activated(performing, built, 'approved', by);
  }
  return refused(performing, built, decision === 'reject' ? 'approver_rejected' : 'unanswered', by);
}

function approval(performing: Performing, approver: string, built: BuiltVersion) {
  return Effect.flatMap(childRunOf(performing.ports.ledger, performing.build.address, approvalReference), (child) => {
    if (child === undefined) {
      return approvalAsked(performing, approver, built);
    }
    return child.run.status === 'started' ? restingUntil(performing, null) : decided(performing, built, child);
  });
}

export function lifecycleStep(performing: Performing, document: PredictionFunctionDefinitionDocument): PerformedStep {
  const { id } = performing.build.address;
  return Effect.flatMap(modelsOf(performing), (state) => {
    const built = Option.getOrThrow(Option.fromNullishOr(versionOfBuild(state, id)));
    const verdict = state.verdicts.get(built.version);
    if (verdict === undefined) {
      return shadowStep(performing, document, state, built);
    }
    if (!verdict) {
      return refused(performing, built, 'shadow_failed', null);
    }
    const { activate } = document.evaluation;
    return activate === 'automatic'
      ? activated(performing, built, 'automatic', null)
      : approval(performing, activate.approved, built);
  });
}
