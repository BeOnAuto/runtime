import type { NotFound, OrgReader } from '@on.auto/operations';
import type { Effect } from 'effect';

import { everyPlaybook, playbookOfKey } from '../entities/playbook-entity.ts';
import type { Playbook } from '../registry/playbook.ts';
import type { Registry } from '../registry/registry.ts';

export const loadRegistry: Effect.Effect<Registry, never, OrgReader> = everyPlaybook;

export function foundPlaybook(playbook: string): Effect.Effect<Playbook, NotFound, OrgReader> {
  return playbookOfKey(playbook);
}
