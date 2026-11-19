import { InvalidInput, PlaybookAdmission, PlaybookContext, type AdmittedPlaybook } from '@on.auto/operations';
import { Effect } from 'effect';

import type { KnownCapabilities } from '../capability/known-capabilities.ts';
import { closedSetRefused } from './closed-set.ts';
import { connectionsRefused, takenRefused, type ConnectionAccess } from './move-destination.ts';
import { membersHeld, type Member } from './move-members.ts';
import { toNamesThisPlaybook, type Named } from './move-words.ts';
import { runsInProgressRefused } from './runs-not-ended.ts';

export interface MoveChecking {
  readonly known: KnownCapabilities;
  readonly started: readonly string[];
  readonly connections: ConnectionAccess;
}

export interface MoveAsked {
  readonly to: string;
  readonly definitions: readonly Named[];
  readonly force?: boolean;
}

export interface CheckedMove {
  readonly admitted: AdmittedPlaybook;
  readonly members: readonly Member[];
}

function refusalsOf({ started, known, connections }: MoveChecking, { admitted, members }: CheckedMove, force: boolean) {
  const { address, reader } = admitted;
  return Effect.andThen(
    Effect.andThen(closedSetRefused(known.types, members), runsInProgressRefused(started, members)),
    Effect.andThen(
      takenRefused(reader, address.playbook, members),
      force ? Effect.void : connectionsRefused(connections, address, members),
    ),
  );
}

const toThisPlaybook = new InvalidInput({
  detail: toNamesThisPlaybook,
  issues: [{ pointer: '/to', detail: toNamesThisPlaybook }],
});

export const checkedMove = Effect.fnUntraced(function* (checking: MoveChecking, { to, definitions, force }: MoveAsked) {
  if (to === (yield* PlaybookContext).playbook) {
    return yield* Effect.fail(toThisPlaybook);
  }
  const admitted = yield* (yield* PlaybookAdmission).admitted(to);
  const members = yield* membersHeld(checking.known, definitions);
  const checked: CheckedMove = { admitted, members };
  yield* refusalsOf(checking, checked, force === true);
  return checked;
});
