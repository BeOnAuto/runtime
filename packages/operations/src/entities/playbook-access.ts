import { Effect } from 'effect';

import { Caller } from '../caller/caller.ts';
import { canAccessPlaybook } from '../caller/playbook-access.ts';

export function readablePlaybooks(playbooks: Iterable<string>): Effect.Effect<readonly string[], never, Caller> {
  return Caller.use(({ playbooks: access }) =>
    Effect.succeed([...playbooks].filter((playbook) => canAccessPlaybook(access, playbook)).toSorted()),
  );
}
