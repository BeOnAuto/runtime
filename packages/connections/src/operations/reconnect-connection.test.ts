import type { CallerIdentity, Outcome, Succeeded } from '@on.auto/operations';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, crm, notes, reconnected, reconnecting, type Added } from '../testing/additions.ts';
import { acmeReader, ada, grace, harness, operationNamed, recordedAs, type Harness } from '../testing/harness.ts';
import { preparedOf, servedAs, sourceOver } from '../testing/served-connections.ts';

const fiveMinutesLater = '2026-10-15T14:05:00.000Z';

const tenMinutesOn = '2026-10-15T14:10:00.000Z';

const elevenMinutesLater = '2026-10-15T14:11:00.000Z';

const keyRefused =
  'The tool server answered HTTP 401: it refused the credential the connection holds, so the person who added it reconnects it';

function giving(h: Harness, { id, token }: Added, value: string, at?: string) {
  return h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value }, at);
}

function reading(h: Harness, { id, token }: Added, at?: string) {
  return h.call(operationNamed(h.operations, 'read_link'), ada, { id, token }, at);
}

async function connectedCrm(h: Harness): Promise<string> {
  const link = await added(h, crm);
  await giving(h, link, 'Bearer crm-key-0f3c9a71');
  return link.id;
}

async function brokenCrm(h: Harness): Promise<string> {
  const id = await connectedCrm(h);
  await Effect.runPromise((await preparedOf(sourceOver(h), id)).refused);
  return id;
}

function openLinkRefusal(expiresAt: string) {
  return {
    status: 'rejected',
    reason: 'conflict',
    detail: `The connection crm waits for its approval through a link that lasts until ${expiresAt}, so it takes no new link before then`,
  };
}

describe('reconnecting a connection its server refused', () => {
  it('answers it broken with a new link, which connects it again with the credential the page gives, forgetting the one before', async () => {
    const h = harness();
    const id = await brokenCrm(h);

    const answered = await reconnecting(h, id);
    const link = await reconnected(h, id, elevenMinutesLater);
    const given = await giving(h, link, 'Bearer crm-key-7d2e4b19', elevenMinutesLater);

    expect(answered).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'broken', broken: keyRefused, connect: { expires_at: tenMinutesOn } },
    });
    expect(given).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'connected',
        broken: null,
        connected_at: elevenMinutesLater,
        connected_by: recordedAs.ada,
        credential_ends_with: '4b19',
      },
    });
    expect([...h.secrets.values().values()]).toEqual(['Bearer crm-key-7d2e4b19']);
    expect((await servedAs(sourceOver(h), id)).state.status).toBe('connected');
  });

  it('is refused while the link it gave is open, naming when it expires, and gives another once it ran out', async () => {
    const h = harness();
    const id = await brokenCrm(h);
    const first = await reconnected(h, id);

    const refused = await reconnecting(h, id, fiveMinutesLater);
    const latest = await reconnected(h, id, elevenMinutesLater);

    expect(refused).toEqual(openLinkRefusal(first.expiresAt));
    expect(await reading(h, latest, elevenMinutesLater)).toMatchObject({
      output: { id, status: 'broken', link: { expires_at: latest.expiresAt } },
    });
    expect(await reading(h, first)).toMatchObject({ reason: 'not_found' });
  });
});

describe('reconnecting a connection that is connected', () => {
  it('leaves it connected with the credential it holds until the page gives another', async () => {
    const h = harness();
    const id = await connectedCrm(h);

    const link = await reconnected(h, id);
    const before = await h.call(operationNamed(h.operations, 'get_connection'), ada, { id });
    await giving(h, link, 'Bearer crm-key-7d2e4b19');

    expect(before).toMatchObject({ output: { status: 'connected', credential_ends_with: '9a71' } });
    expect([...h.secrets.values().values()]).toEqual(['Bearer crm-key-7d2e4b19']);
  });

  it('connects one that takes no credential again through approval', async () => {
    const h = harness();
    const first = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id: first.id, token: first.token });

    const { id, token } = await reconnected(h, first.id, fiveMinutesLater);
    const approved = await h.call(operationNamed(h.operations, 'approve'), ada, { id, token }, fiveMinutesLater);

    expect(approved).toMatchObject({ output: { status: 'connected', connected_at: fiveMinutesLater } });
  });
});

describe('reconnecting a connection that is pending', () => {
  it('gives a new link once the one before expired, and opens the page with it alone', async () => {
    const h = harness();
    const first = await added(h, crm);

    const link = await reconnected(h, first.id, elevenMinutesLater);

    expect(await reading(h, link, elevenMinutesLater)).toMatchObject({
      output: { status: 'pending', link: { expires_at: link.expiresAt } },
    });
    expect(await reading(h, first)).toMatchObject({ reason: 'not_found' });
  });

  it('is refused while its link is open, naming when it expires, and records nothing', async () => {
    const h = harness();
    const { id, expiresAt } = await added(h, crm);
    const factsBefore = (await h.facts()).length;

    expect(await reconnecting(h, id)).toEqual(openLinkRefusal(expiresAt));
    expect((await h.facts()).length).toBe(factsBefore);
  });
});

describe('reconnecting a connection that is not there to reconnect', () => {
  it('is refused for one removed, and for an id the org does not have', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(await reconnecting(h, id)).toMatchObject({
      reason: 'conflict',
      detail: 'The connection notes is removed, so it is added again rather than reconnected',
    });
    expect(await reconnecting(h, 'nowhere')).toMatchObject({ reason: 'not_found' });
  });
});

const localDeveloper: CallerIdentity = { ...ada, id: 'local', name: 'ada' };

describe('who reconnects a connection', () => {
  it('is permitted by org:write alone', async () => {
    const h = harness();
    const id = await brokenCrm(h);

    expect(await h.call(operationNamed(h.operations, 'reconnect_connection'), acmeReader, { id })).toMatchObject({
      reason: 'forbidden',
    });
  });

  it('is the person who added it where people sign in, refusing another person as the page does and a key as adding does', async () => {
    const h = harness({ access: 'people' });
    const id = await brokenCrm(h);
    const key: CallerIdentity = { ...ada, id: 'acme-builder', name: 'acme-builder' };

    const refused = [
      await h.call(operationNamed(h.operations, 'reconnect_connection'), grace, { id }),
      await h.call(operationNamed(h.operations, 'reconnect_connection'), key, { id }),
    ];

    expect(refused).toEqual([
      {
        status: 'rejected',
        reason: 'forbidden',
        detail: 'The connection crm was added by another person, and only they may approve it',
      },
      {
        status: 'rejected',
        reason: 'forbidden',
        detail:
          'A connection is added by a person, through an agent signed in as them, and a key cannot add or reconnect one',
      },
    ]);
    expect(await reconnecting(h, id)).toMatchObject({ status: 'succeeded' });
  });

  it('is the local developer for any connection in local mode', async () => {
    const h = harness({ access: 'local' });
    const { id } = await added(h, crm, { caller: localDeveloper, at: '2026-10-15T13:00:00.000Z' });

    expect(await h.call(operationNamed(h.operations, 'reconnect_connection'), grace, { id })).toMatchObject({
      status: 'succeeded',
    });
  });
});

function outputOf(outcome: Outcome<Succeeded>): unknown {
  return 'output' in outcome ? outcome.output : undefined;
}

function linkingOf(h: Harness) {
  const { registration } = operationNamed(h.operations, 'reconnect_connection');
  return Option.getOrThrow(Option.fromNullishOr('link' in registration ? registration.link : undefined));
}

function wordsOf(h: Harness, output: unknown, id: string): string {
  const { registration } = operationNamed(h.operations, 'reconnect_connection');
  const words = Option.getOrThrow(
    Option.fromNullishOr('plainLanguage' in registration ? registration.plainLanguage : undefined),
  );
  return words.outcome(output, { id });
}

describe('the answer after the link of a reconnection', () => {
  it('asks an agent to have the person open the link, and answers the connection as it stands once they did', async () => {
    const h = harness();
    const id = await brokenCrm(h);
    const outcome = await reconnecting(h, id);
    const link = await reconnected(h, id, elevenMinutesLater);
    await giving(h, link, 'Bearer crm-key-7d2e4b19', elevenMinutesLater);

    const after = await h.call({ registration: linkingOf(h).answerAfter(link) }, ada, { id }, elevenMinutesLater);
    const output = outputOf(outcome);

    expect(linkingOf(h).idOf(output)).toBe(id);
    expect(linkingOf(h).toOpen(output)?.message).toBe(
      'Open this page to approve the connection “crm”, and give its credential where it takes one, within ten minutes.',
    );
    expect(after).toMatchObject({ output: { id, status: 'connected' } });
    expect(after).not.toHaveProperty('output.connect');
    expect(wordsOf(h, outputOf(after), id)).toBe('Connected the connection “crm”; nothing is left to open.');
  });

  it('answers no link where a later reconnection replaced the one it offered', async () => {
    const h = harness();
    const id = await brokenCrm(h);
    const first = await reconnected(h, id);
    await reconnected(h, id, elevenMinutesLater);

    const after = await h.call({ registration: linkingOf(h).answerAfter(first) }, ada, { id }, elevenMinutesLater);

    expect(after).toMatchObject({ output: { id, status: 'broken' } });
    expect(after).not.toHaveProperty('output.connect');
    expect(after).not.toHaveProperty('output.link_ran_out');
  });

  it('says of a connection that stayed connected that the link ran out and it stands as it was', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const link = await reconnected(h, id);

    const after = await h.call({ registration: linkingOf(h).answerAfter(link) }, ada, { id }, elevenMinutesLater);

    expect(after).toMatchObject({ output: { id, status: 'connected', link_ran_out: true } });
    expect(wordsOf(h, outputOf(after), id)).toBe(
      'The link of the connection “crm” ran out unused, so the connection stands as it was, connected.',
    );
  });
});
