import type { Decider } from '@on.auto/operations';

import type { PlaybookCommand } from './playbook-commands.ts';
import { PlaybookEventSchema, type RecordedPlaybookEvent } from './playbook-events.ts';
import { decideOnRegistry, registryContextOf } from './registry-decisions.ts';
import { initialRegistry, evolveRegistry, type Registry } from './registry.ts';

export const registryDecider: Decider<Registry, PlaybookCommand, RecordedPlaybookEvent, 'not_found' | 'conflict'> = {
  initialState: initialRegistry,
  evolve: evolveRegistry,
  decide: decideOnRegistry,
  context: registryContextOf,
  eventSchema: PlaybookEventSchema,
};
