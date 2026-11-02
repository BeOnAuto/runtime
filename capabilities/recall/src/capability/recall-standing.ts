import { viewStandingOf, type Standing } from '@on.auto/definitions';
import type { KeptView, ViewsPort } from '@on.auto/workflow-host';
import { Effect } from 'effect';

export function recallStanding(views: ViewsPort): Standing {
  return ({ org, playbook, name, version, status }) =>
    status === 'retired'
      ? Effect.undefined
      : Effect.all([views.viewOf({ org, playbook }, name), views.newestRecordAt({ org, playbook })]).pipe(
          Effect.map(([kept, newestAt]: readonly [KeptView | undefined, string | undefined]) =>
            viewStandingOf(version, kept, newestAt),
          ),
        );
}
