import { OrgReader, type NotFound } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Playbook } from '../registry/playbook.ts';
import { playbooksStream } from '../registry/playbooks-stream.ts';
import { registryDecider } from '../registry/registry-decider.ts';
import { findPlaybook } from '../registry/registry-lookup.ts';
import type { Registry } from '../registry/registry.ts';

export const loadRegistry: Effect.Effect<Registry, never, OrgReader> = Effect.gen(function* () {
  const { state } = yield* (yield* OrgReader).load(playbooksStream, registryDecider);
  return state;
});

export function foundPlaybook(playbook: string): Effect.Effect<Playbook, NotFound, OrgReader> {
  return loadRegistry.pipe(Effect.flatMap((registry) => findPlaybook(registry, playbook)));
}
