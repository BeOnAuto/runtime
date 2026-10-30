import { playbookCallerOf, streamPrefixOfPlaybook } from '@on.auto/operations';
import { Clock, DateTime, Effect } from 'effect';

import type { Performing } from '../build-work/build-performing.ts';
import { modelsStreamOf } from '../facts/model-facts.ts';
import type { Verdict } from '../shadow/shadow-grades.ts';
import { modelsDecider, type ModelCommand } from './model-decider.ts';
import type { BuiltVersion, ModelsState } from './model-state.ts';

type Asked = Pick<ModelCommand, 'at' | 'by' | 'name'>;

function streamOf({ build }: Pick<Performing, 'build'>): string {
  const { org, playbook } = build.address;
  return `${streamPrefixOfPlaybook({ org, playbook })}${modelsStreamOf(build.run.run.name)}`;
}

export function modelsOf(performing: Performing): Effect.Effect<ModelsState> {
  return Effect.map(performing.ports.ledger.load(streamOf(performing), modelsDecider), ({ state }) => state);
}

export function executed(performing: Performing, command: (asked: Asked) => ModelCommand): Effect.Effect<void> {
  const { ports, build, lineage } = performing;
  const { org, playbook } = build.address;
  return Effect.gen(function* () {
    const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
    const full = command({ name: build.run.run.name, at, by: playbookCallerOf({ org, playbook }).id });
    return yield* ports.ledger
      .execute(streamOf(performing), modelsDecider, full, lineage)
      .pipe(Effect.asVoid, Effect.orDie);
  });
}

export function decided(
  performing: Performing,
  challenger: BuiltVersion,
  verdict: Verdict,
  metric: string,
): Effect.Effect<void> {
  return executed(performing, (asked) => ({
    ...asked,
    type: 'decide',
    definitionVersion: challenger.definitionVersion,
    passed: verdict.passed,
    data: {
      version: challenger.version,
      build: performing.build.address.id,
      metric,
      challenger: verdict.challenger,
      active: verdict.active,
      ...(verdict.ungradedCloses === undefined ? {} : { ungraded_closes: verdict.ungradedCloses }),
    },
  }));
}
