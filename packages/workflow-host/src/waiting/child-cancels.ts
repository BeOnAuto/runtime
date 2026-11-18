import type { CancelRun } from '@on.auto/definitions';
import type { CallFunctions, CancelReason } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import type { CancelChild } from '../calls/call-cancels.ts';

const reasons: Readonly<Record<CancelReason, string>> = {
  deadline: 'The step that waited for this run ran out of time, so it no longer needs it',
  parent_ended: 'The run that waited for this run ended first, or the branch that waited for it lost a race',
};

export type CalledOf = NonNullable<CallFunctions['calledOf']>;

export function childCancelsOn(cancel: CancelRun, calledOf: CalledOf): CancelChild {
  return ({ child: { org, playbook, runId }, call, reason, lineage }) => {
    const called = call === null ? undefined : calledOf(call);
    return called === undefined
      ? Effect.succeed('unknown_run')
      : cancel(
          { org, playbook, id: runId, definitionType: called.type, name: called.name },
          { kind: reason, reason: reasons[reason] },
          lineage,
        );
  };
}
