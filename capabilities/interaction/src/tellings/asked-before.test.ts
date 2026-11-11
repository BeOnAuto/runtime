import { describe, expect, it } from 'vitest';

import {
  chatConversations,
  chatHarness,
  chatProjections,
  farAhead,
  keptAsRecorded,
  playbookUser,
  recordedTellingsBefore,
  recordsOf,
  tellingsBefore,
} from '../testing/index.ts';
import { ledgerHoldingRuns } from '../testing/interaction-harness.ts';

const { toldBefore, waitingUntold } = tellingsBefore;

const channel = '#approvals-sales';

describe('requests asked before a provider could say how its conversations are replied to', () => {
  it('tell what main told and nothing of a taken reply, though the provider now marks and replies', async () => {
    const recorded = recordedTellingsBefore();
    const ledger = ledgerHoldingRuns(chatProjections);
    await keptAsRecorded(ledger.service, recorded.facts);
    const playbook = await chatHarness({ ledger, inTheChat: recorded.messages, conversations: chatConversations });
    playbook.chat.reply({ channel, thread: '1699.000001', user: playbookUser, text: 'approve' });
    playbook.chat.reply({ channel, thread: '1699.000002', user: playbookUser, text: 'approve' });

    await playbook.performReads(Date.now() + farAhead);
    await playbook.performDue(Date.now() + farAhead);

    expect((await recordsOf(playbook.ledger, 'request_answered')).map(({ context }) => context['runId'])).toEqual(
      expect.arrayContaining([toldBefore, waitingUntold]),
    );
    expect(playbook.chat.reactions()).toEqual([]);
    expect(playbook.chat.calls().filter(({ reference }) => reference.tool === 'post_message')).toEqual([]);
  });
});
