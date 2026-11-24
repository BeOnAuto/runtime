import type { Work } from '@on.auto/definitions';
import { Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ChatHarnessOptions } from './chat-harness.ts';
import type { FakeTools } from './fake-tools.ts';

type Recording = NonNullable<ChatHarnessOptions['recording']>;

export function failingToRecord(refused: (work: Work) => boolean): Recording {
  return (record) => (run, work, lineage, rule) =>
    refused(work) ? Effect.fail(new Unavailable({ detail: 'The ledger is down' })) : record(run, work, lineage, rule);
}

export function afterTheParts(interfering: () => Promise<void>): Recording {
  return (record) => (run, work, lineage, rule) =>
    Effect.tap(record(run, work, lineage, rule), () =>
      work.type === 'work' && work.fact.type === 'answer_set' ? Effect.promise(interfering) : Effect.void,
    );
}

export function recordingParts(work: Work): boolean {
  return work.type === 'work' && work.fact.type === 'answer_set';
}

export function recordingAnswer(work: Work): boolean {
  return work.type === 'answer';
}

export function interferingBeforeTheFirstEdit(interfere: () => Promise<unknown>): (chat: FakeTools) => FakeTools {
  const interfered = { done: false };
  return (chat) => ({
    ...chat,
    preparedCall: (call) => {
      const first = call.reference.tool === 'update_message' && !interfered.done;
      interfered.done = interfered.done || first;
      return first ? Effect.andThen(Effect.promise(interfere), chat.preparedCall(call)) : chat.preparedCall(call);
    },
  });
}

export function recordingRefusals(work: Work): boolean {
  return work.type === 'work' && work.fact.type === 'reply_refused';
}
