import { describe, expect, it } from 'vitest';

import { added, crm, issuesIn, lastFact, notes } from '../testing/additions.ts';
import { acmeReader, acmeWriter, ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

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
