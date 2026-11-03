import { Conflict } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aLedgerOfMemories, factsIn, rowsIn, type HarnessLedger } from '../testing/harness-services.ts';
import { idOf, memoryHarness, recallDocument, rememberDocument, type MemoryHarness } from '../testing/index.ts';
import { memoryKeeperOn } from './kept-in-a-ledger.ts';
import type { MemoryKeeper } from './memory-keeper.ts';

interface KeptApart {
  readonly organization: HarnessLedger;
  readonly alpha: MemoryHarness;
  readonly beta: MemoryHarness;
}

const ofTheOrganization = { org: 'acme' };

function askedAsData(keeper: MemoryKeeper): MemoryKeeper {
  return {
    readyToRemember: (ask, acting) => keeper.readyToRemember(structuredClone(ask), structuredClone(acting)),
    remembered: (ask, acting) => keeper.remembered(structuredClone(ask), structuredClone(acting)),
    rowsRead: (address, query) => keeper.rowsRead(structuredClone(address), structuredClone(query)),
    standingOf: (at) => keeper.standingOf(structuredClone(at)),
    forgotten: (at, acting) => keeper.forgotten(structuredClone(at), structuredClone(acting)),
    erased: (at, acting) => keeper.erased(structuredClone(at), structuredClone(acting)),
    moved: (from, to, acting) => keeper.moved(structuredClone(from), to, structuredClone(acting)),
  };
}

function keptApart(organizationAs: (keeper: MemoryKeeper) => MemoryKeeper = (keeper) => keeper): KeptApart {
  const organization = aLedgerOfMemories();
  const playbooks = new Map([
    ['alpha', aLedgerOfMemories()],
    ['beta', aLedgerOfMemories()],
  ]);
  const keeperOfTheOrganization = organizationAs(memoryKeeperOn({ ledger: organization.service }));
  const keeperOfThePlaybook = (playbook: string) =>
    memoryKeeperOn({ ledger: (playbooks.get(playbook) ?? organization).service });
  const port = askedAsData({
    ...keeperOfTheOrganization,
    erased: (at, acting) =>
      at.scope === 'organization'
        ? keeperOfTheOrganization.erased(at, acting)
        : keeperOfThePlaybook(at.place.playbook).erased(at, acting),
  });
  const harnessOf = (playbook: string) =>
    memoryHarness({ ledger: playbooks.get(playbook) ?? organization, organization: () => port });
  return { organization, alpha: harnessOf('alpha'), beta: harnessOf('beta') };
}

function rememberingOnceRefused(): (keeper: MemoryKeeper) => MemoryKeeper {
  let refused = false;
  return (keeper) => ({
    ...keeper,
    remembered: (ask, acting) =>
      Effect.suspend(() => {
        const first = !refused;
        refused = true;
        return first
          ? Effect.fail(new Conflict({ detail: 'The ledger of the organization stopped' }))
          : keeper.remembered(ask, acting);
      }),
  });
}

async function textsIn(ledger: HarnessLedger, stream: string): Promise<readonly (string | null)[]> {
  const facts = await factsIn(ledger, stream);
  return facts.flatMap((fact) => (fact.type === 'memory_remembered' ? [fact.data.text] : []));
}

const textsOf = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ memories: Schema.Array(Schema.Struct({ text: Schema.String })) }) }),
);

async function recalledBy(harness: MemoryHarness, playbook: string, input: object): Promise<readonly string[]> {
  const recalled = textsOf(await harness.call(harness.operations.recall, input, { playbook }));
  return recalled.output.memories.map(({ text }) => text);
}

describe('the memories of the organization, kept apart from the ledger of each playbook', () => {
  it('are kept where the organization keeps them, and recalled by another playbook beside its own, newest first', async () => {
    const { organization, alpha, beta } = keptApart();
    const id = await alpha.rememberedId({ text: 'We bill in euros', scope: 'organization' });
    await beta.rememberedId({ text: 'Beta drafts on Mondays' }, { playbook: 'beta', at: '2026-10-02T09:00:00.000Z' });

    const recalled = await beta.call(beta.operations.recall, {}, { playbook: 'beta', at: '2026-10-03T09:00:00.000Z' });

    expect(recalled).toMatchObject({
      status: 'succeeded',
      output: {
        memories: [
          { scope: 'playbook', text: 'Beta drafts on Mondays' },
          { id, scope: 'organization', text: 'We bill in euros' },
        ],
      },
    });
    expect(await factsIn(organization, `org/acme/memories/${id}`)).toMatchObject([{ type: 'memory_remembered' }]);
    expect([await alpha.rowsOf(ofTheOrganization), await beta.rowsOf(ofTheOrganization)]).toEqual([[], []]);
  });

  it('are listed by a playbook and by the organization from where the organization keeps them', async () => {
    const { alpha } = keptApart();
    const id = await alpha.rememberedId({ text: 'We bill in euros', scope: 'organization' });

    const ofThePlaybook = await alpha.call(alpha.operations.listMemories, {});
    const ofTheOrg = await alpha.callInOrg(alpha.operations.listOrgMemories, {});

    expect([ofThePlaybook, ofTheOrg]).toMatchObject([
      { status: 'succeeded', output: { memories: [{ id, scope: 'organization' }] } },
      { status: 'succeeded', output: { memories: [{ id, scope: 'organization' }] } },
    ]);
  });
});

describe('the memories of the organization, forgotten, erased and moved apart from the ledger of each playbook', () => {
  it('are forgotten and erased where the organization keeps them, whichever playbook asks', async () => {
    const { organization, alpha, beta } = keptApart();
    const forgottenId = await alpha.rememberedId({ text: 'Drafts need two reviews', scope: 'organization' });
    const erasedId = await alpha.rememberedId({ text: 'The vault code is 4417', scope: 'organization' });

    const forgotten = await beta.call(beta.operations.forget, { id: forgottenId }, { playbook: 'beta' });
    const erased = await beta.call(beta.operations.forget, { id: erasedId, erase: true }, { playbook: 'beta' });

    expect([forgotten, erased]).toMatchObject([
      { status: 'succeeded', output: { id: forgottenId, scope: 'organization', status: 'forgotten' } },
      { status: 'succeeded', output: { id: erasedId, scope: 'organization', status: 'erased' } },
    ]);
    expect(await textsIn(organization, `org/acme/memories/${erasedId}`)).toEqual([null]);
    expect(await recalledBy(alpha, 'alpha', { scope: 'organization' })).toEqual([]);
  });

  it('are moved each way between a playbook and the organization, and erased across both moves from the playbook a memory left', async () => {
    const { organization, alpha, beta } = keptApart();
    const id = await alpha.rememberedId({ text: 'Learned by alpha, needed by beta' });

    const toTheOrganization = idOf(await alpha.call(alpha.operations.moveMemory, { id, to: 'organization' }));
    const intoBeta = idOf(
      await beta.call(beta.operations.moveMemory, { id: toTheOrganization, to: 'playbook' }, { playbook: 'beta' }),
    );
    const recalled = await recalledBy(beta, 'beta', { scope: 'playbook' });
    const erased = await alpha.call(alpha.operations.forget, { id: toTheOrganization, erase: true });

    expect(recalled).toEqual(['Learned by alpha, needed by beta']);
    expect(await factsIn(organization, `org/acme/memories/${toTheOrganization}`)).toMatchObject([
      { type: 'memory_remembered', data: { moved_from: { scope: 'playbook', playbook: 'alpha', id } } },
      { type: 'memory_moved', data: { to: 'playbook', as: intoBeta, playbook: 'beta' } },
      { type: 'memory_erased' },
    ]);
    expect(erased).toMatchObject({ status: 'succeeded', output: { status: 'erased' } });
    expect([
      await alpha.factsOf(`playbook/acme/alpha/memories/${id}`).then((facts) => facts.map(({ type }) => type)),
      await textsIn(organization, `org/acme/memories/${toTheOrganization}`),
      (await beta.rowsOf({ org: 'acme', playbook: 'beta' }))[0]?.row['text'],
    ]).toEqual([['memory_remembered', 'memory_moved', 'memory_erased'], [null], null]);
  });
});

describe('a move between a playbook and the organization, cut short between the two', () => {
  it('leaves the memory marked moved and kept nowhere, and completes as it is asked again, under the same id', async () => {
    const { organization, alpha } = keptApart(rememberingOnceRefused());
    const id = await alpha.rememberedId({ text: 'Moved in two goes' });

    const cut = await alpha.call(alpha.operations.moveMemory, { id, to: 'organization' });
    const between = [await rowsIn(organization, ofTheOrganization), await recalledBy(alpha, 'alpha', {})];
    const completed = await alpha.call(alpha.operations.moveMemory, { id, to: 'organization' });

    expect(cut).toMatchObject({ status: 'rejected', detail: 'The ledger of the organization stopped' });
    expect(between).toEqual([[], []]);
    expect(completed).toMatchObject({ status: 'succeeded', output: { scope: 'organization' } });
    expect((await rowsIn(organization, ofTheOrganization)).map(({ key }) => key)).toEqual([idOf(completed)]);
    expect(await recalledBy(alpha, 'alpha', {})).toEqual(['Moved in two goes']);
  });

  it('keeps no copy where the memory is erased before the move is asked again, which answers the id it was moved as', async () => {
    const { organization, alpha } = keptApart(rememberingOnceRefused());
    const id = await alpha.rememberedId({ text: 'A secret moved in two goes' });
    await alpha.call(alpha.operations.moveMemory, { id, to: 'organization' });

    const erased = await alpha.call(alpha.operations.forget, { id, erase: true });
    const completed = await alpha.call(alpha.operations.moveMemory, { id, to: 'organization' });

    expect(erased).toMatchObject({ status: 'succeeded', output: { id, status: 'erased' } });
    expect(completed).toMatchObject({ status: 'succeeded', output: { scope: 'organization', version: 1 } });
    expect(await factsIn(organization, `org/acme/memories/${idOf(completed)}`)).toMatchObject([
      { type: 'memory_forgotten', data: { version: 0 } },
    ]);
    expect(await rowsIn(organization, ofTheOrganization)).toEqual([]);
  });
});

describe('a memory function of a playbook whose ledger keeps none of the organization', () => {
  it('saves and runs one that remembers for the organization, which another playbook recalls', async () => {
    const { organization, alpha, beta } = keptApart();
    await alpha.define('keep-for-everyone', rememberDocument(['scope: organization']));
    await beta.define('recall-everything', recallDocument(), { playbook: 'beta' });

    const kept = await alpha.run('keep-for-everyone', { fact: 'Launches wait for the legal review' });
    const recalled = await beta.run('recall-everything', { fact: '' }, { playbook: 'beta' });

    expect(kept).toMatchObject({ output: { status: 'succeeded', output: { version: 1, scope: 'organization' } } });
    expect(recalled).toMatchObject({
      output: { output: { memories: [{ scope: 'organization', text: 'Launches wait for the legal review' }] } },
    });
    expect(await rowsIn(organization, ofTheOrganization)).toMatchObject([
      { row: { source_definition: 'keep-for-everyone', status: 'kept' } },
    ]);
  });
});
