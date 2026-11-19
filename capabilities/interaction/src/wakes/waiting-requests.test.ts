import type { Ledger } from '@on.auto/operations';
import { mostInlinePayloadBytes } from '@on.auto/operations/payloads';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answererId, chatHarness, type ChatHarness } from '../testing/chat-harness.ts';
import { chatProjections } from '../testing/chat-projections.ts';
import { alpha, ledgerHoldingRuns, type HarnessLedger } from '../testing/interaction-harness.ts';
import { readOnce, theChannel } from '../testing/woken-conversations.ts';
import { waitingRequestsOf } from './waiting-requests.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

function waitingIn(playbook: Pick<ChatHarness, 'ledger'>, inAPage?: number, mostBytes = 1_048_576) {
  const parts = { ledger: playbook.ledger.service, mostRequestBytesTo: () => mostBytes };
  return Effect.runPromise(waitingRequestsOf(parts, alpha, inAPage));
}

describe('the requests that wait for replies in a conversation of a connection', () => {
  it('are the open requests delivered there, each with the arguments of the call that delivered it and where it was sent', async () => {
    const playbook = await chatHarness();
    await playbook.askInThread(runId);

    expect(await waitingIn(playbook)).toEqual([]);

    await playbook.performDue(Date.now());
    const [delivery] = playbook.chat.calls();
    const [waiting] = await waitingIn(playbook);

    expect(waiting).toMatchObject({ connection: 'chat', sent: { conversation: theChannel } });
    expect(waiting?.with).toEqual(delivery?.input);
    expect(await waitingIn(playbook, undefined, 1)).toEqual([]);
  });

  it('are read page after page, and leave out a request once it is answered', async () => {
    const playbook = await chatHarness();
    const second = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e';
    await playbook.askInThread(runId);
    await playbook.askInThread(second);
    await playbook.performDue(Date.now());

    expect((await waitingIn(playbook, 1)).map(({ sent }) => sent.conversation)).toEqual([theChannel, theChannel]);

    const waiting = await readOnce(runId);
    waiting.approve();
    await waiting.playbook.performReads(waiting.readAt + 60_000);

    expect(await waitingIn(waiting.playbook)).toEqual([]);
  });
});

function ledgerThatLoses(isLost: () => boolean): HarnessLedger {
  const kept = ledgerHoldingRuns(chatProjections);
  const { content } = kept.service;
  const read: Ledger['Service']['content'] = {
    ...content,
    get: (owner, sha256) => (isLost() ? Effect.undefined : content.get(owner, sha256)),
    getHead: (owner, sha256) => (isLost() ? Effect.undefined : content.getHead(owner, sha256)),
  };
  return { ...kept, service: { ...kept.service, content: read } };
}

function ledgerThatLosesARun(lost: { readonly run?: string }): HarnessLedger {
  const kept = ledgerHoldingRuns(chatProjections);
  const { holderOfStream } = kept.service;
  const holder: Ledger['Service']['holderOfStream'] = (named) =>
    lost.run !== undefined && named.stream.endsWith(lost.run) ? Effect.undefined : holderOfStream(named);
  return { ...kept, service: { ...kept.service, holderOfStream: holder } };
}

describe('a request whose run cannot be read', () => {
  it('waits nowhere the loop can read, and the other requests of the playbook are still read', async () => {
    const lost: { run?: string } = {};
    const playbook = await chatHarness({ ledger: ledgerThatLosesARun(lost) });
    await playbook.askInThread(runId);
    await playbook.askInThread('0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e');
    await playbook.performDue(Date.now());
    lost.run = runId;

    expect(await waitingIn(playbook)).toHaveLength(1);
  });
});

describe('a request whose input the playbook kept outside its run', () => {
  it('waits nowhere the loop can read once that input is lost', async () => {
    const lost = { now: false };
    const playbook = await chatHarness({ ledger: ledgerThatLoses(() => lost.now), payloadOffloading: true });
    await playbook.ask(
      'approve-brief',
      { team: 'sales', owner: answererId, campaign: 'Spring', brief: 's'.repeat(mostInlinePayloadBytes) },
      runId,
    );
    await playbook.performDue(Date.now());

    expect(await waitingIn(playbook)).toHaveLength(1);

    lost.now = true;

    expect(await waitingIn(playbook)).toEqual([]);
  });
});
