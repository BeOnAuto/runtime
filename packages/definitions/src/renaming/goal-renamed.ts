import { Caller, PlaybookContext, PlaybookWriter, recordedCallerOf } from '@on.auto/operations';
import { Effect } from 'effect';

import { decisionsOnGoalsAndDefinitions } from '../goals/decisions-on-goals-and-definitions.ts';
import { goalDecider, goalStream, noGoalWithTheId, refusedAt, theIdItHas } from '../goals/goal-decider.ts';
import { goalStatesIn } from '../goals/playbook-goals.ts';
import { commandMetadata } from '../operations/command-metadata.ts';
import { loadRegistry } from '../operations/registry-access.ts';
import { definitionDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { resavedServerOf, servingWorkflowsOf, type GoalRenamer, type GoalRenaming } from './goal-servers.ts';
import { goalRenameRefused } from './rename-checks.ts';

export const playbookGoalRenamed = Effect.fnUntraced(function* (renamer: GoalRenamer, renaming: GoalRenaming) {
  const { from, to } = renaming;
  if (to === from) {
    return yield* refusedAt('/rename_goal/new_id', theIdItHas);
  }
  const held = (yield* goalStatesIn).find(({ name }) => name === from);
  if (held === undefined) {
    return yield* refusedAt('/rename_goal/id', noGoalWithTheId(from));
  }
  const { type } = renamer.workflow;
  const servers = servingWorkflowsOf(yield* loadRegistry(type), renaming);
  const savedAgain = servers.map(({ name }) => ({ type, name }));
  yield* goalRenameRefused(renamer.started, savedAgain, from);
  const resaved = yield* Effect.forEach(servers, resavedServerOf(renamer, renaming));
  const address = yield* PlaybookContext;
  const metadata = yield* commandMetadata;
  const renamedBy = recordedCallerOf(yield* Caller);
  yield* (yield* PlaybookWriter)
    .executeOnDefinitions(
      decisionsOnGoalsAndDefinitions(
        [
          {
            definition: held.definition,
            stream: goalStream,
            decider: goalDecider(held.definition),
            command: { type: 'rename', from, to, renamed_by: renamedBy, playbook: address.playbook, ...metadata },
          },
        ],
        resaved.map(({ stored: { definition_id: definition, name, version }, content }) => ({
          definition,
          stream: definitionTypeStreamOf(type),
          decider: definitionDecider(type, address, definition),
          command: { type: 'update' as const, name, content, expectedVersion: version, ...metadata },
        })),
      ),
    )
    .pipe(Effect.catchTag('not_found', Effect.die));
  return { savedAgain };
});
