import { ownCallDecider } from '../own-calls/own-call-decider.ts';
import type { OwnCallKind } from '../own-calls/own-call-journal.ts';
import { HandCallEventSchema, type RecordedHandCall } from './hand-call-events.ts';

export const handCallDecider = ownCallDecider<RecordedHandCall>({
  first: ['tool_call_started'],
  after: { tool_call_started: ['tool_call_answered', 'tool_call_failed'] },
  eventSchema: HandCallEventSchema,
  outOfTurn: 'A call made by hand records its start once and then how it ended once, so this is not recorded',
});

export const handCalls: OwnCallKind<RecordedHandCall> = {
  decider: handCallDecider,
  started: (fact) => ({ type: 'tool_call_started', data: fact }),
  ended: (fact) => fact,
};
