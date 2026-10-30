import { defineCommand, randomUUIDv7 } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { handCallContext } from '../hand-calls/hand-call-journal.ts';
import { tracedByHand } from '../one-call/traced-calls.ts';
import { toolRemedies, unavailableOf } from '../tool-reads/tool-refusals.ts';
import { ExecuteInputSchema, ExecutedSchema } from './execute-schemas.ts';
import { executeAttempted, executeTask, executed } from './execute-words.ts';
import { answeredOn, offeredIn } from './executed-call.ts';

const description = [
  "Calls one tool of a tool server this playbook's functions may use, with the arguments it is given, as a run of a reasoning function would call it, and answers what that run's model would see.",
  'Use it when the person asks for what a tool does, or to learn what a tool answers before a function names it, in place of a function made to look.',
  'The call is live and acts as the playbook, so it needs the permission to change the playbook whatever the tool does; search says which tools only read, and dry_run what this would check.',
  "It is recorded in the playbook's history, with its content where the server's entry keeps it.",
  '`server` and `tool` name the tool as search lists it, and `arguments` is the object its input_schema takes.',
].join(' ');

export function defineExecute(access: Pick<ToolAccess, 'open' | 'configured'>) {
  return defineCommand('playbook', {
    name: 'execute',
    title: 'Execute a tool call',
    description,
    route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/execute' },
    reachesOutside: true,
    mayChangeOutside: access.configured,
    inputSchema: ExecuteInputSchema,
    outputSchema: ExecutedSchema,
    reasons: ['unavailable'],
    handle: Effect.fnUntraced(function* ({ server, tool, arguments: input = {} }) {
      const callId = randomUUIDv7();
      const context = yield* handCallContext(callId);
      const called = { reference: { server, tool }, callId, input };
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const tools = yield* restore(access.open(context, [called.reference]));
          const offered = yield* offeredIn(tools, called);
          return yield* tracedByHand(called.reference, offered.server, answeredOn(tools, offered, called, restore));
        }),
      ).pipe(Effect.mapError(unavailableOf));
    }),
    plainLanguage: {
      task: executeTask,
      attempt: (asked) => executeAttempted(asked),
      outcome: (answer) => executed(answer),
      remedies: toolRemedies,
    },
  });
}
