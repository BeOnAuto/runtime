import type { Outcome } from '@on.auto/operations';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { type Added, added, crm, issuesIn, lastFact, notes, reconnected, reconnecting } from '../testing/additions.ts';
import { brokenCrm, connectedCrm, giving } from '../testing/crm-connections.ts';
import { acmeReader, acmeWriter, ada, harness, type Harness, operationNamed } from '../testing/harness.ts';

const fiveMinutesLater = '2026-10-15T14:05:00.000Z';

const aDayAndAMinuteLater = '2026-10-16T14:01:00.000Z';

const aDayAndTenMinutesLater = '2026-10-16T14:10:00.000Z';

function outputOf(outcome: Outcome): unknown {
  return 'output' in outcome ? outcome.output : undefined;
}

function linkingOf(h: Harness) {
  const { registration } = operationNamed(h.operations, 'reconnect_connection');
  return Option.getOrThrow(Option.fromNullishOr('link' in registration ? registration.link : undefined));
}

function answeredAfter(h: Harness, link: Added, at: string): Promise<Outcome> {
  return h.call({ registration: linkingOf(h).answerAfter(link) }, ada, { id: link.id }, at);
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
    const link = await reconnected(h, id, aDayAndAMinuteLater);
    await giving(h, link, 'Bearer crm-key-7d2e4b19', aDayAndAMinuteLater);

    const after = await answeredAfter(h, link, aDayAndAMinuteLater);
    const output = outputOf(outcome);

    expect(linkingOf(h).idOf(output)).toBe(id);
    expect(linkingOf(h).toOpen(output)?.message).toBe(
      'Open this page to approve the connection “crm”, and give its credential where it takes one, within 24 hours.',
    );
    expect(after).toMatchObject({ output: { id, status: 'connected' } });
    expect(after).not.toHaveProperty('output.connect');
    expect(wordsOf(h, outputOf(after), id)).toBe('Connected the connection “crm”; nothing is left to open.');
  });

  it('says of a connection that stayed connected that the link ran out and it stands as it was', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const link = await reconnected(h, id);

    const after = await answeredAfter(h, link, aDayAndAMinuteLater);

    expect(after).toMatchObject({ output: { id, status: 'connected', link_ran_out: true } });
    expect(wordsOf(h, outputOf(after), id)).toBe(
      'The link for the connection “crm” expired unused. The connection is still connected.',
    );
  });
});

describe('the answer after a link a later reconnection replaced', () => {
  it('says a newer link replaced it while the newer one is open, and to reconnect once that one ran out too', async () => {
    const h = harness();
    const id = await brokenCrm(h);
    const first = await reconnected(h, id);
    await reconnected(h, id, fiveMinutesLater);

    const whileOpen = await answeredAfter(h, first, fiveMinutesLater);
    const ranOut = await answeredAfter(h, first, aDayAndTenMinutesLater);

    expect(whileOpen).toMatchObject({ output: { id, status: 'broken', link_replaced: true } });
    expect(whileOpen).not.toHaveProperty('output.connect');
    expect(wordsOf(h, outputOf(whileOpen), id)).toBe(
      'The connection “crm” is broken. A newer link is available. The person who added the connection should open that link; reconnecting would replace it again.',
    );
    expect(ranOut).toMatchObject({ output: { id, status: 'broken' } });
    expect(ranOut).not.toHaveProperty('output.link_replaced');
    expect(ranOut).not.toHaveProperty('output.link_ran_out');
    expect(wordsOf(h, outputOf(ranOut), id)).toBe(
      'The connection “crm” is broken, and its link is used up or expired, so nothing is left to open: reconnect it for a new link.',
    );
  });

  it('answers no link where the link it offered was used up before a later reconnection gave another', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const used = await reconnected(h, id);
    await giving(h, used, 'Bearer crm-key-7d2e4b19');
    await reconnected(h, id, fiveMinutesLater);

    const after = await answeredAfter(h, used, fiveMinutesLater);

    expect(after).toMatchObject({ output: { id, status: 'connected' } });
    expect(after).not.toHaveProperty('output.connect');
    expect(after).not.toHaveProperty('output.link_replaced');
  });
});

function setting(h: Harness, input: unknown, caller = ada) {
  return h.call(operationNamed(h.operations, 'set_connection_playbooks'), caller, input);
}

function reading(h: Harness, id: string) {
  return h.call(operationNamed(h.operations, 'get_connection'), ada, { id });
}

describe('setting which playbooks may use a connection', () => {
  it('records the playbooks named, each once, and answers the connection that serves them alone', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    const set = await setting(h, { id, playbooks: ['sales', 'support', 'sales'] });

    expect(set).toMatchObject({
      status: 'succeeded',
      output: { id, status: 'pending', entry: { url: notes.entry.url, playbooks: ['sales', 'support'] } },
    });
    expect(await lastFact(h)).toEqual({ connection: id, playbooks: ['sales', 'support'] });
    expect(await reading(h, id)).toMatchObject({ output: { entry: { playbooks: ['sales', 'support'] } } });
  });

  it('gives the connection to every playbook of the org for null, its entry then naming none', async () => {
    const h = harness();
    const { id } = await added(h, crm);

    const set = await setting(h, { id, playbooks: null });

    expect(set).toMatchObject({ status: 'succeeded', output: { entry: { url: crm.entry.url, allowed: ['search'] } } });
    expect(set).not.toHaveProperty('output.entry.playbooks');
    expect(await lastFact(h)).toEqual({ connection: id, playbooks: null });
  });

  it('records nothing where the connection serves those playbooks already, in whatever order they are named', async () => {
    const h = harness();
    const named = await added(h, { ...crm, entry: { ...crm.entry, playbooks: ['sales', 'support'] } });
    const every = await added(h, notes);
    const factsBefore = (await h.facts()).length;

    const outcomes = [
      await setting(h, { id: named.id, playbooks: ['support', 'sales'] }),
      await setting(h, { id: every.id, playbooks: null }),
    ];

    expect(outcomes).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
    expect((await h.facts()).length).toBe(factsBefore);
  });
});

describe('a connected connection given other playbooks', () => {
  it('is answered as reading it answers it, the ending of its credential among it', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);
    await h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value: 'Bearer crm-5e1d7a0f3c' });

    const set = await setting(h, { id, playbooks: ['support'] });
    const read = await reading(h, id);

    expect(set).toMatchObject({ status: 'succeeded', output: { status: 'connected', credential_ends_with: '0f3c' } });
    expect(read).toMatchObject({ output: { entry: { playbooks: ['support'] }, credential_ends_with: '0f3c' } });
  });
});

describe('a setting of playbooks refused', () => {
  it('names no playbook, a malformed playbook id or no playbooks at all at its place', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    const [none, malformed, missing] = await Promise.all([
      setting(h, { id, playbooks: [] }),
      setting(h, { id, playbooks: ['sales', 'Sales Team'] }),
      setting(h, { id }),
    ]);

    expect([none, malformed, missing]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'rejected', reason: 'invalid_input' },
      { status: 'rejected', reason: 'invalid_input' },
    ]);
    expect(issuesIn(none)).toEqual([
      { pointer: '/playbooks', detail: 'Expected at least one playbook id, or null for every playbook' },
    ]);
    expect(issuesIn(malformed).map(({ pointer }) => pointer)).toEqual(['/playbooks/1']);
    expect(issuesIn(missing).map(({ pointer }) => pointer)).toEqual(['/playbooks']);
  });

  it('refuses a removed connection as a conflict and an id the org does not have as not found, recording nothing', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });
    const factsBefore = (await h.facts()).length;

    expect(await setting(h, { id, playbooks: ['sales'] })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The connection notes is removed, so no playbook may use it',
    });
    expect(await setting(h, { id: 'nowhere', playbooks: ['sales'] })).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no connection nowhere in this org',
    });
    expect((await h.facts()).length).toBe(factsBefore);
  });
});

describe('the caller who sets which playbooks may use a connection', () => {
  it('is permitted by org:write, whoever added the connection, and refused to a caller who may only read the org', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    expect(await setting(h, { id, playbooks: ['sales'] }, acmeReader)).toMatchObject({ reason: 'forbidden' });
    expect(await setting(h, { id, playbooks: ['sales'] }, acmeWriter)).toMatchObject({ status: 'succeeded' });
  });

  it('is refused to a caller that may access only some playbooks of the org, whatever it names, recording nothing', async () => {
    const h = harness();
    const { id } = await added(h, { ...notes, entry: { ...notes.entry, playbooks: ['support'] } });
    const salesWriter = { ...acmeWriter, id: 'acme-sales-writer', playbooks: ['sales'] };
    const factsBefore = (await h.facts()).length;

    const refused = [
      await setting(h, { id, playbooks: ['sales', 'support'] }, salesWriter),
      await setting(h, { id, playbooks: null }, salesWriter),
      await setting(h, { id, playbooks: ['sales'] }, salesWriter),
    ];

    expect(refused).toEqual(
      Array.from({ length: 3 }, () => ({
        status: 'rejected',
        reason: 'forbidden',
        detail:
          'The caller may access only some playbooks of this org, so it cannot change which playbooks may use a connection',
      })),
    );
    expect((await h.facts()).length).toBe(factsBefore);
  });
});
