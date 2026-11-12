import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import {
  alpha,
  approvalDocument,
  chatDelivery,
  chatHarness,
  conversationRows,
  farAhead,
  wakesHeard,
} from '../testing/index.ts';
import { everythingRecorded, readOnce, theChannel } from '../testing/woken-conversations.ts';
import { connectionWake } from './connection-wakes.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

const theFailureAskedAfter: unknown = expect.any(String);

describe('a wake where nothing waits through the connection', () => {
  it('does nothing and writes nothing in a playbook that asked nobody', async () => {
    const playbook = await chatHarness();
    const recorded = await everythingRecorded(playbook.ledger);

    await Effect.runPromise(
      connectionWake({ ledger: playbook.ledger.service })({ playbook: alpha, connection: 'chat' }, 0),
    );

    expect([await conversationRows(playbook.ledger), await everythingRecorded(playbook.ledger)]).toEqual([
      [],
      recorded,
    ]);
  });

  it('leaves a conversation whose requests were answered as it is, open or rested', async () => {
    const waiting = await readOnce(runId);
    await waiting.playbook.call(answerInteraction, { run_id: runId, answer: { choice: 'approve' } });
    const open = await waiting.row();

    await waiting.wake(waiting.readAt);
    await waiting.playbook.performReads(Date.now() + farAhead);
    const rested = await waiting.row();
    await waiting.wake(Date.now(), { conversation: theChannel });

    expect([open, rested, await waiting.row()]).toEqual([open, rested, rested]);
    expect(rested).toMatchObject({ open: false, due_at: null });
  });
});

describe('a wake of a conversation where requests wait that it may not read', () => {
  it('makes nothing due for a request delivered there whose function reads no replies', async () => {
    const playbook = await chatHarness();
    await playbook.define('ask-owner', approvalDocument(chatDelivery));
    await playbook.ask('ask-owner', { owner: 'ada', campaign: 'Spring' }, runId);
    await playbook.performDue(Date.now());
    const recorded = await everythingRecorded(playbook.ledger);
    const wake = connectionWake({ ledger: playbook.ledger.service });

    await Effect.runPromise(wake({ playbook: alpha, connection: 'chat', conversation: '#approvals-ada' }, Date.now()));

    expect([await conversationRows(playbook.ledger), await everythingRecorded(playbook.ledger)]).toEqual([
      [],
      recorded,
    ]);
    expect(await playbook.firstOpen()).toMatchObject({ delivery: { server: 'chat', tool: 'post_message' } });
  });

  it('never reads through another connection than the one woken', async () => {
    const waiting = await readOnce(runId);
    const before = await waiting.row();

    await waiting.wake(waiting.readAt, { connection: 'mail' });
    await waiting.wake(waiting.readAt, { connection: 'mail', conversation: theChannel });

    expect(await waiting.row()).toEqual(before);
  });
});

describe('a wake of a conversation its server asked to wait', () => {
  it('never shortens the wait the server asked for', async () => {
    const waiting = await readOnce(runId);
    waiting.playbook.chat.answerNext({
      outcome: 'server_failure',
      detail: 'The tool server answered HTTP 429',
      retryAfterMs: 120_000,
    });
    await waiting.playbook.performReads(Date.now() + farAhead);
    const asked = await waiting.row();

    await waiting.wake(Date.now());

    expect(await waiting.row()).toEqual(asked);
    expect(asked).toMatchObject({ waited_after: theFailureAskedAfter });
  });
});

describe('an arrival that wakes a connection', () => {
  it('writes no fact and no row for itself, moving only when the conversation is due', async () => {
    const waiting = await readOnce(runId);
    const recorded = await everythingRecorded(waiting.playbook.ledger);
    const before = await waiting.row();

    await waiting.wake(waiting.readAt);

    expect(await everythingRecorded(waiting.playbook.ledger)).toEqual(recorded);
    expect(await waiting.row()).toEqual({ ...before, due_at: waiting.readAt + 5000 });
  });
});

describe('the wake a later piece is handed in its tests', () => {
  it('hears each wake and when it came, and reads nothing', async () => {
    const heard = wakesHeard();

    await Effect.runPromise(heard.wake({ playbook: alpha, connection: 'chat', conversation: theChannel }, 1000));

    expect(heard.heard()).toEqual([{ playbook: alpha, connection: 'chat', conversation: theChannel, at: 1000 }]);
  });
});
