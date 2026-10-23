import type { CancelledAttempt, JournalRefusal, RunAttempt, RunJournal } from '@on.auto/definitions';
import type { CallsEndedBecause } from '@on.auto/tool-servers';
import { toolsInWords } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';
import { factsOf, interruptedEnds, type AttemptFacts } from '../steps/attempt-facts.ts';
import type { Spent, ToolUse } from '../tools/tool-endings.ts';
import { spendingRecord } from './spending-record.ts';

export const restartedWithoutContent =
  'The server restarted before the run finished, and the playbook keeps no content of its calls to go on from';

export interface AfterTheFacts {
  readonly use: ToolUse;
  readonly spent: Spent;
}

export interface BeforeTheSteps extends AfterTheFacts {
  readonly ended: Effect.Effect<void, JournalRefusal>;
}

export function afterTheFacts({ used, spent }: AttemptFacts, serversEnded: CallsEndedBecause | null): AfterTheFacts {
  const tools = [...used.values()];
  return {
    use: {
      calledAny: tools.length > 0,
      onlyRead: tools.every(({ readOnly }) => readOnly),
      inWords: toolsInWords(tools.map(({ server, tool }) => ({ server, tool }))),
      ending: serversEnded,
    },
    spent: spent.calls === 0 ? {} : { record: spendingRecord(spent.usage, spent.duration_ms, spent) },
  };
}

export function beforeTheSteps(journal: RunJournal, model: string): BeforeTheSteps {
  const facts = factsOf(journal.attempt);
  return {
    ...afterTheFacts(facts, null),
    ended: Effect.forEach(interruptedEnds(facts, model), (fact) => journal.record(fact), { discard: true }),
  };
}

export function cancelledAttemptOf(
  { model }: ReasoningFunctionDefinitionDocument,
  attempt: RunAttempt,
): CancelledAttempt {
  const facts = factsOf(attempt);
  return { ends: interruptedEnds(facts, model), ...afterTheFacts(facts, null).spent };
}
