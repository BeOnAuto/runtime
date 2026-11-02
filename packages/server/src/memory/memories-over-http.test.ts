import { Schema } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const beta = '/v1/orgs/acme/playbooks/beta';

const decodeKept = Schema.decodeUnknownSync(
  Schema.Struct({ id: Schema.String, version: Schema.Number, scope: Schema.String }),
);

const ListedSchema = Schema.Struct({
  id: Schema.String,
  scope: Schema.String,
  status: Schema.String,
  text: Schema.NullOr(Schema.String),
  playbook: Schema.optionalKey(Schema.String),
});

const decodeListing = Schema.decodeUnknownSync(Schema.Struct({ memories: Schema.Array(ListedSchema) }));

const decodeRecalled = Schema.decodeUnknownSync(
  Schema.Struct({ memories: Schema.Array(Schema.Struct({ scope: Schema.String, text: Schema.String })) }),
);

const decodeFreeRuns = Schema.decodeUnknownSync(Schema.Struct({ free_runs: Schema.Struct({ used: Schema.Number }) }));

let server: ReasoningServer;

beforeAll(async () => {
  server = await servingReasoning([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'beta', name: 'Beta' } });
});

afterAll(async () => {
  await server.stop();
});

async function remembered(playbook: string, body: Readonly<Record<string, unknown>>): Promise<string> {
  const answer = await server.call('POST', `${playbook}/memories`, { body });
  return decodeKept(answer.body).id;
}

async function recalledIn(playbook: string, body: Readonly<Record<string, unknown>>) {
  return decodeRecalled((await server.call('POST', `${playbook}/memories/recall`, { body })).body).memories;
}

async function listedAt(path: string): Promise<(typeof ListedSchema.Type)[]> {
  return [...decodeListing((await server.call('GET', `${path}/memories?limit=100`)).body).memories];
}

function standingOf(listed: readonly (typeof ListedSchema.Type)[], ids: readonly string[]) {
  return ids.map((wanted) => listed.find(({ id }) => id === wanted)).map((memory) => [memory?.status, memory?.text]);
}

function sortedScopes(memories: readonly { readonly scope: string }[]): readonly string[] {
  return memories.map(({ scope }) => scope).toSorted();
}

describe('the memories of a playbook over HTTP', () => {
  it('are kept for the playbook alone or for its organization, which every playbook of the organization recalls', async () => {
    await remembered(alpha, { text: 'The weekly report opens with the pipeline', tags: ['reports'] });
    await remembered(alpha, {
      text: 'Budgets over 10,000 need the approval of the finance lead',
      tags: ['budgets'],
      scope: 'organization',
    });

    const inAlpha = await recalledIn(alpha, { tags: [] });
    const inBeta = await recalledIn(beta, { words: 'BUDGETS finance' });

    expect(sortedScopes(inAlpha)).toEqual(['organization', 'playbook']);
    expect(inBeta).toEqual([
      { scope: 'organization', text: 'Budgets over 10,000 need the approval of the finance lead' },
    ]);
  });

  it('are forgotten, or erased, and listed with what became of each, an erased one without its text', async () => {
    const forgotten = await remembered(alpha, { text: 'Drafts go out on Mondays', tags: ['drafts'] });
    const erased = await remembered(alpha, { text: 'The office answers on 555 0100', tags: ['contacts'] });
    await server.call('POST', `${alpha}/memories/${forgotten}/forget`, { body: {} });
    const erasing = await server.call('POST', `${alpha}/memories/${erased}/forget`, { body: { erase: true } });

    expect(erasing.body).toEqual({ id: erased, scope: 'playbook', status: 'erased' });
    expect(await recalledIn(alpha, { tags: ['contacts'] })).toEqual([]);
    expect(standingOf(await listedAt(alpha), [forgotten, erased])).toEqual([
      ['forgotten', 'Drafts go out on Mondays'],
      ['erased', null],
    ]);
  });
});

describe('the memories of a playbook and of its organization over HTTP', () => {
  it('moves a memory of the playbook to its organization under a new id, which a move asked again answers', async () => {
    const kept = await remembered(alpha, { text: 'Invoices are sent in euros', tags: ['billing'] });

    const moved = await server.call('POST', `${alpha}/memories/${kept}/move`, { body: { to: 'organization' } });
    const again = await server.call('POST', `${alpha}/memories/${kept}/move`, { body: { to: 'organization' } });

    expect(again.body).toEqual(moved.body);
    expect(moved.body).toMatchObject({ version: 1, scope: 'organization' });
    expect(await recalledIn(beta, { tags: ['billing'] })).toEqual([
      { scope: 'organization', text: 'Invoices are sent in euros' },
    ]);
    expect(standingOf(await listedAt(alpha), [kept])).toEqual([['moved', 'Invoices are sent in euros']]);
  });

  it('are listed for the organization with its own and those of each playbook, by the playbook that keeps each', async () => {
    const reported = await remembered(beta, { text: 'Beta reports on Fridays', tags: ['reports'] });

    const listed = await listedAt('/v1/orgs/acme');

    expect(listed.find(({ id }) => id === reported)).toMatchObject({ scope: 'playbook', playbook: 'beta' });
    expect(listed.some(({ scope }) => scope === 'organization')).toBe(true);
  });

  it('refuses a memory out of its bounds at its field, and counts no call among the free runs of the runtime', async () => {
    const before = decodeFreeRuns((await server.call('GET', '/v1/orgs/acme/license')).body);

    const refused = await server.call('POST', `${alpha}/memories`, { body: { text: 'Kept', tags: ['Not A Tag'] } });
    await recalledIn(alpha, { words: 'reports' });

    expect(refused).toMatchObject({ status: 422, body: { reason: 'invalid_input' } });
    expect(decodeFreeRuns((await server.call('GET', '/v1/orgs/acme/license')).body)).toEqual(before);
  });
});
