import { providersOf, tracker } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { added, crm, crmKeyHelp } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const [trackersKey] = tracker.credentials;

const formatted = { ...tracker, credentials: [{ ...trackersKey, example: 'trk_…', pattern: '^trk_[A-Za-z0-9]+$' }] };

const fromTheProvider = { provider: 'tracker', placeholders: { site: 'acme' } };

const describedByTheAgent = { ...crm, credential: { ...crm.credential, example: 'crm_…', pattern: '^crm_\\w+$' } };

function giving(h: Harness, input: Readonly<Record<string, string>>) {
  return h.call(operationNamed(h.operations, 'give_credential'), ada, input);
}

function reading(h: Harness, input: Readonly<Record<string, string>>) {
  return h.call(operationNamed(h.operations, 'read_link'), ada, input);
}

describe('the key a person gives for the pattern of its provider', () => {
  it('is refused at its place in another format, keeping nothing and leaving the link open, and taken in its format', async () => {
    const h = harness({ providers: providersOf(formatted) });
    const { id, token } = await added(h, fromTheProvider);

    const refused = await giving(h, { id, token, value: 'ghp_not-a-tracker-key' });
    const kept = [...h.secrets.values()];
    const taken = await giving(h, { id, token, value: 'trk_0f3cAcme' });

    expect(refused).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The credential cannot be taken as it is given',
      issues: [
        { pointer: '/value', detail: "Paste the key itself: this value is not in the format of the provider's keys" },
      ],
    });
    expect(kept).toEqual([]);
    expect(taken).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(taken).not.toHaveProperty('output.pattern_unmatched');
  });
});

describe('the key a person gives for the pattern an agent wrote', () => {
  it('is kept in another format, connected, and answered with pattern_unmatched, and in its format answered without it', async () => {
    const h = harness();
    const unmatched = await added(h, describedByTheAgent);
    const matched = await added(h, { ...describedByTheAgent, name: 'crm-matched' });

    const outOfFormat = await giving(h, { id: unmatched.id, token: unmatched.token, value: 'sk_live_0f3c' });
    const inFormat = await giving(h, { id: matched.id, token: matched.token, value: 'crm_0f3c' });

    expect(outOfFormat).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', pattern_unmatched: true },
    });
    expect([...h.secrets.values().values()]).toEqual(['sk_live_0f3c', 'crm_0f3c']);
    expect(inFormat).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(inFormat).not.toHaveProperty('output.pattern_unmatched');
  });
});

describe('the reading of a link of a connection by a key', () => {
  it('answers how the key is made in its credential, as the agent wrote it or as its provider gives it', async () => {
    const h = harness({ providers: providersOf(formatted) });
    const byHand = await added(h, describedByTheAgent);
    const byProvider = await added(h, fromTheProvider);

    const read = [
      await reading(h, { id: byHand.id, token: byHand.token }),
      await reading(h, { id: byProvider.id, token: byProvider.token }),
    ];

    expect(read).toMatchObject([
      {
        status: 'succeeded',
        output: { provider: null, credential: { ...crmKeyHelp, example: 'crm_…', pattern: '^crm_\\w+$' } },
      },
      {
        status: 'succeeded',
        output: {
          provider: 'tracker',
          credential: {
            instructions: trackersKey?.instructions,
            key_page: 'https://app.tracker.example.com/settings/keys',
            example: 'trk_…',
            pattern: '^trk_[A-Za-z0-9]+$',
          },
        },
      },
    ]);
  });
});
