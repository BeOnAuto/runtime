import { PlaybookContext, PlaybookWriter, Caller, noLineage, streamPrefixOfPlaybook } from '@on.auto/operations';
import { Effect } from 'effect';

import type { CallerContext } from '../access/caller-context.ts';
import { callIdKey } from '../calls/call-meta.ts';
import { ownCallJournal } from '../own-calls/own-call-journal.ts';
import { handCalls } from './hand-call-decider.ts';
import { handCallStreamOf } from './hand-call-events.ts';

const handCallJournal = Effect.fnUntraced(function* (callId: string) {
  const writer = yield* PlaybookWriter;
  const stream = handCallStreamOf(callId);
  const inThePlaybook = `${streamPrefixOfPlaybook(yield* PlaybookContext)}${stream}`;
  const { id: by } = yield* Caller;
  return ownCallJournal(handCalls, { writer, stream, inThePlaybook, by, lineage: noLineage });
});

export const handCallContext = Effect.fnUntraced(function* (callId: string) {
  const { org, playbook } = yield* PlaybookContext;
  const journal = yield* handCallJournal(callId);
  const context: CallerContext = { id: callId, org, playbook, journal, meta: { [callIdKey]: callId } };
  return context;
});
