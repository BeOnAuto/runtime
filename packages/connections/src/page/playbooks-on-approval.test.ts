import type { FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { afterEach, describe, expect, it } from 'vitest';

import { added, crm, issuesIn, notes } from '../testing/additions.ts';
import { consentFake, consentHarnessAt } from '../testing/consents.ts';
import { ada, grace, harness, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function served(): Promise<FakeMcpServer> {
  const fake = await consentFake();
  closing.push(fake.close);
  return fake;
}

function calling(h: Harness, operation: string, input: unknown, caller = ada) {
  return h.call(operationNamed(h.operations, operation), caller, input);
}

async function typesRecorded(h: Harness): Promise<readonly string[]> {
  return (await h.facts()).map(({ type }) => type);
}

const notesForSales = { ...notes, entry: { ...notes.entry, playbooks: ['sales'] } };

const limitedRefusal = {
  status: 'rejected',
  reason: 'forbidden',
  detail:
    'The caller may access only some playbooks of this org, so it cannot change which playbooks may use a connection',
};

describe('approving a connection with the playbooks that may use it', () => {
  it('records the playbooks named, each once, with the approval, and answers the connection connected for them', async () => {
    const h = harness();
    const { id, token } = await added(h, notesForSales);

    const approved = await calling(h, 'approve', { id, token, playbooks: ['support', 'billing', 'support'] });

    expect(approved).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', entry: { playbooks: ['support', 'billing'] } },
    });
    expect((await typesRecorded(h)).slice(-3)).toEqual([
      'connection_playbooks_set',
      'connection_approved',
      'connection_connected',
    ]);
  });

  it('keeps the playbooks the entry names where they are left out or named again', async () => {
    const h = harness();
    const leftOut = await added(h, notesForSales);
    const namedAgain = await added(h, { ...notesForSales, name: 'notes-again' });

    const outcomes = [
      await calling(h, 'approve', { id: leftOut.id, token: leftOut.token }),
      await calling(h, 'approve', { id: namedAgain.id, token: namedAgain.token, playbooks: ['sales'] }),
    ];

    expect(outcomes).toMatchObject([
      { output: { status: 'connected', entry: { playbooks: ['sales'] } } },
      { output: { status: 'connected', entry: { playbooks: ['sales'] } } },
    ]);
    expect(await typesRecorded(h)).not.toContain('connection_playbooks_set');
  });
});

describe('giving the credential of a connection with the playbooks that may use it', () => {
  it('gives the connection to every playbook for null, its entry then naming none', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    const given = await calling(h, 'give_credential', { id, token, value: 'Bearer crm-0f3c', playbooks: null });

    expect(given).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', entry: { url: crm.entry.url } },
    });
    expect(given).not.toHaveProperty('output.entry.playbooks');
  });
});

describe('starting the consent of a connection with the playbooks that may use it', () => {
  it('records them with the start, so the link reads them before the person signs in', async () => {
    const h = consentHarnessAt(await served());
    const { id, token } = await added(h, { provider: 'files' });

    const started = await calling(h, 'start', { id, token, playbooks: ['support'] });
    const read = await calling(h, 'read_link', { id, token });

    expect(started).toMatchObject({ status: 'succeeded' });
    expect((await typesRecorded(h)).slice(-2)).toEqual(['connection_playbooks_set', 'connection_consent_started']);
    expect(read).toMatchObject({ output: { status: 'pending', entry: { playbooks: ['support'] } } });
  });
});

describe('an approval with playbooks refused', () => {
  it('refuses an empty list at its place on each approving call, and records nothing', async () => {
    const h = harness();
    const byConsent = consentHarnessAt(await served());
    const none = await added(h, notes);
    const secret = await added(h, crm);
    const consent = await added(byConsent, { provider: 'files' });
    const recordedBefore = [(await h.facts()).length, (await byConsent.facts()).length];

    const refused = [
      await calling(h, 'approve', { id: none.id, token: none.token, playbooks: [] }),
      await calling(h, 'give_credential', {
        id: secret.id,
        token: secret.token,
        value: 'Bearer crm-0f3c',
        playbooks: [],
      }),
      await calling(byConsent, 'start', { id: consent.id, token: consent.token, playbooks: [] }),
    ];

    expect(refused.map((outcome) => issuesIn(outcome).map(({ pointer }) => pointer))).toEqual([
      ['/playbooks'],
      ['/playbooks'],
      ['/playbooks'],
    ]);
    expect([(await h.facts()).length, (await byConsent.facts()).length]).toEqual(recordedBefore);
  });
});

describe('an approval by a caller that may access only some playbooks of the org', () => {
  it('is refused where it gives playbooks, on each approving call, and records nothing', async () => {
    const h = harness();
    const byConsent = consentHarnessAt(await served());
    const none = await added(h, notesForSales);
    const secret = await added(h, crm);
    const consent = await added(byConsent, { provider: 'files' });
    const salesWriter = { ...ada, playbooks: ['sales'] };
    const recordedBefore = [(await h.facts()).length, (await byConsent.facts()).length];

    const refused = [
      await calling(h, 'approve', { id: none.id, token: none.token, playbooks: ['sales'] }, salesWriter),
      await calling(
        h,
        'give_credential',
        { id: secret.id, token: secret.token, value: 'Bearer crm-0f3c', playbooks: null },
        salesWriter,
      ),
      await calling(byConsent, 'start', { id: consent.id, token: consent.token, playbooks: ['sales'] }, salesWriter),
    ];

    expect(refused).toEqual(Array.from({ length: 3 }, () => limitedRefusal));
    expect([(await h.facts()).length, (await byConsent.facts()).length]).toEqual(recordedBefore);
    expect([...h.secrets.values().values()]).toEqual([]);
    expect([...byConsent.secrets.values().values()]).toEqual([]);
  });

  it('goes on where it gives none, and the connection keeps its playbooks', async () => {
    const h = harness();
    const { id, token } = await added(h, notesForSales);

    const approved = await calling(h, 'approve', { id, token }, { ...ada, playbooks: ['sales'] });

    expect(approved).toMatchObject({ status: 'succeeded', output: { entry: { playbooks: ['sales'] } } });
  });
});

describe('an approval with playbooks by another person than the one who added the connection', () => {
  it('changes nothing', async () => {
    const h = harness();
    const { id, token } = await added(h, notesForSales);
    const recordedBefore = (await h.facts()).length;

    const refused = await calling(h, 'approve', { id, token, playbooks: ['support'] }, grace);

    expect(refused).toMatchObject({ status: 'rejected', reason: 'forbidden' });
    expect((await h.facts()).length).toBe(recordedBefore);
  });
});
