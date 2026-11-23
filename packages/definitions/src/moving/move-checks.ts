import { InvalidInput, PlaybookAdmission, PlaybookContext, type AdmittedPlaybook } from '@on.auto/operations';
import { Effect } from 'effect';

import type { KnownCapabilities } from '../capability/known-capabilities.ts';
import { closedSetRefused } from './closed-set.ts';
import { anotherReadRefusedIn, connectionsRefused, takenRefused, type ConnectionAccess } from './move-destination.ts';
import {
  goalRulesRefused,
  goalsNamed,
  goalsTakenRefused,
  placedThere,
  type GoalsOfAMove,
  type MovingGoal,
} from './move-goals.ts';
import { mostDefinitionsMovedAtOnce } from './move-input.ts';
import { distinct, membersHeld, type Member } from './move-members.ts';
import { neitherGiven, tooManyNamedWords, toNamesThisPlaybook, type Named } from './move-words.ts';
import { runsInProgressRefused } from './runs-not-ended.ts';

export interface MoveChecking {
  readonly known: KnownCapabilities;
  readonly started: readonly string[];
  readonly connections: ConnectionAccess;
  readonly messages: boolean;
}

export interface MoveAsked {
  readonly to: string;
  readonly definitions?: readonly Named[];
  readonly goals?: readonly string[];
  readonly force?: boolean;
}

export interface CheckedMove {
  readonly admitted: AdmittedPlaybook;
  readonly members: readonly Member[];
  readonly goals: readonly MovingGoal[];
}

interface Checking {
  readonly admitted: AdmittedPlaybook;
  readonly members: readonly Member[];
  readonly goals: GoalsOfAMove;
}

function refusalsOf(
  { started, known, connections, messages }: MoveChecking,
  { admitted, members, goals }: Checking,
  force: boolean,
) {
  const { address, reader } = admitted;
  return Effect.gen(function* () {
    yield* closedSetRefused(known.types, members);
    yield* goalRulesRefused({ messages }, admitted, goals, members);
    yield* runsInProgressRefused(started, members);
    yield* takenRefused(reader, address.playbook, members);
    yield* goalsTakenRefused(admitted, goals);
    yield* anotherReadRefusedIn(reader, address.playbook, members);
    yield* force ? Effect.void : connectionsRefused(connections, address, members);
  });
}

const toThisPlaybook = new InvalidInput({
  detail: toNamesThisPlaybook,
  issues: [{ pointer: '/to', detail: toNamesThisPlaybook }],
});

const nothingNamed = new InvalidInput({ detail: neitherGiven, issues: [] });

export function namedInTheCall({ definitions = [], goals = [] }: Omit<MoveAsked, 'to'>): number {
  return distinct(definitions).length + new Set(goals).size;
}

function namedRefusal(named: number): InvalidInput | undefined {
  if (named === 0) {
    return nothingNamed;
  }
  return named > mostDefinitionsMovedAtOnce
    ? new InvalidInput({ detail: tooManyNamedWords(named, mostDefinitionsMovedAtOnce), issues: [] })
    : undefined;
}

export const checkedMove = Effect.fnUntraced(function* (
  checking: MoveChecking,
  { to, definitions = [], goals: ids = [], force }: MoveAsked,
) {
  if (to === (yield* PlaybookContext).playbook) {
    return yield* Effect.fail(toThisPlaybook);
  }
  const refused = namedRefusal(namedInTheCall({ definitions, goals: ids }));
  if (refused !== undefined) {
    return yield* Effect.fail(refused);
  }
  const admitted = yield* (yield* PlaybookAdmission).admitted(to);
  const members = yield* membersHeld(checking.known, definitions);
  const goals = yield* goalsNamed(ids);
  yield* refusalsOf(checking, { admitted, members, goals }, force === true);
  const checked: CheckedMove = { admitted, members, goals: yield* placedThere(admitted, goals) };
  return checked;
});
