import type { ProjectedRow } from '@on.auto/operations';
import { Effect } from 'effect';

import { connectionWake, type WokenConnection } from '../wakes/connection-wakes.ts';
import { answererId, chatHarness, conversationRows, farAhead, type ChatHarness } from './chat-harness.ts';
import { threadDocument, threadReplies } from './documents.ts';
import { alpha, type HarnessLedger } from './interaction-harness.ts';

const everyFiveSeconds = threadDocument({ replies: threadReplies.filter((line) => line !== '  wait: PT1M') });

export const theChannel = '#approvals-sales';

export interface ReadOnce {
  readonly playbook: ChatHarness;
  readonly readAt: number;
  readonly wake: (now: number, place?: Partial<Omit<WokenConnection, 'playbook'>>) => Promise<void>;
  readonly approve: () => void;
  readonly row: () => Promise<ProjectedRow | undefined>;
}

export async function readOnce(runId: string): Promise<ReadOnce> {
  const playbook = await chatHarness({ document: everyFiveSeconds });
  await playbook.askInThread(runId);
  await playbook.performDue(Date.now());
  await playbook.performReads(Date.now() + farAhead);
  const readAt = Date.now();
  const wake = connectionWake({ ledger: playbook.ledger.service });
  const [thread] = playbook.chat.posted().map(({ ts }) => ts);
  return {
    playbook,
    readAt,
    wake: (now, place = {}) => Effect.runPromise(wake({ playbook: alpha, connection: 'chat', ...place }, now)),
    approve: () => {
      playbook.chat.reply({ channel: theChannel, thread, user: answererId, text: 'approve' });
    },
    row: async () => (await conversationRows(playbook.ledger))[0]?.row,
  };
}

export async function everythingRecorded(ledger: HarnessLedger): Promise<readonly unknown[]> {
  const { records } = await Effect.runPromise(
    ledger.service.readRecorded(alpha, { kind: 'everything' }, { order: 'asc', limit: 100 }),
  );
  return records;
}
