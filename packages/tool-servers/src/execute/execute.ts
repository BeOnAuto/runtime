import { defineCommand, randomUUIDv7 } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { handCallContext } from '../hand-calls/hand-call-journal.ts';
import { tracedByHand } from '../one-call/traced-calls.ts';
import { toolRemedies, unavailableOf } from '../tool-reads/tool-refusals.ts';
import { inTheListing, readsOnlyIn } from './connection-checks.ts';
import { ExecuteInputSchema, ExecutedSchema } from './execute-schemas.ts';
import { executeAttempted, executeTask, executed } from './execute-words.ts';
import { answeredOn, offeredIn, type HandCall } from './executed-call.ts';

type ConnectionAccess = Pick<ToolAccess, 'open' | 'configured'>;

const sharedSentences = [
  "It is recorded in the playbook's history, with its content where the server's entry keeps it.",
  '`server` and `tool` name the tool as search lists it, and `arguments` is the object its input_schema takes.',
];

const executeDescription = [
  "Calls one tool of a connected service this playbook's functions may use, whatever its mark, on the service's own API as its tool list names the tool, with the arguments it is given, and answers what a run of a function would see.",
  'Use it when the person asks for what a tool that may change something does, such as sending, creating or deleting, and to set a service up for the playbook, before its runs act on it.',
  'The call is live and acts as the playbook, so it needs the permission to change the playbook; search says the mark of each tool, and dry_run what this would check.',
  ...sharedSentences,
].join(' ');

const queryDescription = [
  "Calls one tool marked reads of a connected service this playbook's functions may use, on the service's own API as its tool list names the tool, with the arguments it is given, and answers what a run of a function would see.",
  'Use it to read what a tool answers, or to find an id a function needs; it refuses a tool not marked reads, which execute_connection calls.',
  'The call is live and acts as the playbook, so it needs the permission to change the playbook; search with only read lists the tools it calls.',
  ...sharedSentences,
].join(' ');

function handCallOf(access: ConnectionAccess, onlyReads: boolean) {
  return Effect.fnUntraced(function* ({ server, tool, arguments: input = {} }: typeof ExecuteInputSchema.Type) {
    const callId = randomUUIDv7();
    const context = yield* handCallContext(callId);
    const called: HandCall = { reference: { server, tool }, callId, input };
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const tools = yield* restore(access.open(context, [called.reference]));
        const listed = yield* inTheListing(tools, yield* offeredIn(tools, called));
        const offered = onlyReads ? yield* readsOnlyIn(tools, listed) : listed;
        return yield* tracedByHand(called.reference, offered.server, answeredOn(tools, offered, called, restore));
      }),
    ).pipe(Effect.mapError(unavailableOf));
  });
}

const plainLanguage = {
  task: executeTask,
  attempt: executeAttempted,
  outcome: executed,
  remedies: toolRemedies,
};

export function defineExecuteConnection(access: ConnectionAccess) {
  return defineCommand('playbook', {
    name: 'execute_connection',
    title: 'Execute a connection tool',
    description: executeDescription,
    route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/execute' },
    reachesOutside: true,
    mayChangeOutside: access.configured,
    inputSchema: ExecuteInputSchema,
    outputSchema: ExecutedSchema,
    reasons: ['unavailable'],
    handle: handCallOf(access, false),
    plainLanguage,
  });
}

export function defineQueryConnection(access: ConnectionAccess) {
  return defineCommand('playbook', {
    name: 'query_connection',
    title: 'Query a connection tool',
    description: queryDescription,
    route: { method: 'POST', path: '/tool-servers/{server}/tools/{tool}/query' },
    reachesOutside: true,
    readsOnly: true,
    inputSchema: ExecuteInputSchema,
    outputSchema: ExecutedSchema,
    reasons: ['unavailable'],
    handle: handCallOf(access, true),
    plainLanguage,
  });
}
