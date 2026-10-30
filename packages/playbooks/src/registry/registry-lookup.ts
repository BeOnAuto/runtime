import { NotFound } from '@on.auto/operations';
import { Effect } from 'effect';

import type { Playbook } from './playbook.ts';
import type { Registry } from './registry.ts';

export function playbookNotFound(id: string): NotFound {
  return new NotFound({ detail: `There is no playbook ${id} in this org` });
}

export function findPlaybook(registry: Registry, id: string): Effect.Effect<Playbook, NotFound> {
  const playbook = registry.get(id);
  return playbook === undefined ? Effect.fail(playbookNotFound(id)) : Effect.succeed(playbook);
}
