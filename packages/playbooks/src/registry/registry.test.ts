import { type CallerIdentity, defineCommand, defineQuery, makeDispatcher, PlaybookRegistry } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { activePlaybooksOf, createPlaybook, ledgerPlaybookRegistry, retirePlaybook } from '../index.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { harness, toOrg } from '../testing/harness.ts';
import { playbookCreatedOf } from './created-playbooks.ts';

const anyWords: unknown = expect.any(String);

const context = { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' };

const created = {
  playbook: 'alpha',
  name: 'Alpha',
  description: '',
  created_by: { id: 'acme-admin', name: 'acme-admin' },
};

describe('the playbook a record of an org creates', () => {
  it('is named by its creation, and by no other record or one without who created it and when', () => {
    expect([
      playbookCreatedOf({ type: 'playbook_created', data: created, context }),
      playbookCreatedOf({ type: 'playbook_retired', data: { playbook: 'alpha' }, context }),
      playbookCreatedOf({ type: 'playbook_created', data: 'not a fact', context }),
      playbookCreatedOf({ type: 'playbook_created', data: created }),
    ]).toEqual(['alpha', undefined, undefined, undefined]);
  });
});

const toAcme = toOrg('acme');

function statusOf(org: string, playbook: string) {
  return PlaybookRegistry.use((registry) => registry.status({ org, playbook }));
}

const Empty = Schema.Record(Schema.String, Schema.Never);

const ping = defineQuery('playbook', {
  name: 'ping',
  title: 'Ping',
  description: 'Answers from within a playbook.',
  route: { method: 'GET', path: '/ping' },
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () => Effect.succeed({}),
});

const poke = defineCommand('playbook', {
  name: 'poke',
  title: 'Poke',
  description: 'Changes nothing within a playbook.',
  route: { method: 'POST', path: '/poke' },
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () => Effect.succeed({}),
});

function calling(operation: typeof ping | typeof poke, caller: CallerIdentity, org: string, playbook: string) {
  return makeDispatcher([]).dispatchToPlaybook(operation.registration, {
    caller,
    org,
    playbook,
    input: {},
    encoding: 'json',
  });
}

describe('the playbook registry on the ledger', () => {
  it('knows a playbook as active from its creation, and as retired from its retirement', async () => {
    const { call, run } = harness(ledgerPlaybookRegistry);

    expect(await run(statusOf('acme', 'alpha'))).toBe('unknown');
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    expect(await run(statusOf('acme', 'alpha'))).toBe('active');
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'alpha' }));
    expect(await run(statusOf('acme', 'alpha'))).toBe('retired');
  });

  it('reads the very stream the playbook operations write', async () => {
    const { call, ledger, run } = harness(ledgerPlaybookRegistry);
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));

    expect(ledger.streamNames()).toEqual(['org/acme/playbooks']);
    expect(await run(statusOf('acme', 'alpha'))).toBe('active');
  });

  it('keeps the playbooks of each org apart', async () => {
    const { call, run } = harness(ledgerPlaybookRegistry);
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));

    expect(await run(statusOf('acme', 'alpha'))).toBe('active');
    expect(await run(statusOf('globex', 'alpha'))).toBe('unknown');
    expect(await run(statusOf('acme', 'beta'))).toBe('unknown');
  });

  it('lists the active playbooks of an org, by one read of its registry, and neither a retired one nor another org’s', async () => {
    const { call, ledger, run } = harness(ledgerPlaybookRegistry);
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'beta', name: 'Beta' }));
    await call(retirePlaybook, toAcme(acmeAdmin, { playbook: 'beta' }));
    await call(createPlaybook, toOrg('globex')(globexAdmin, { playbook: 'gamma', name: 'Gamma' }));

    expect(await run(activePlaybooksOf(ledger.service, { org: 'acme' }))).toEqual([{ org: 'acme', playbook: 'alpha' }]);
  });
});

describe('a retired playbook, to an operation within it', () => {
  it('answers a query, so what it recorded stays readable', async () => {
    const { call, run } = harness(ledgerPlaybookRegistry);
    await call(createPlaybook, toOrg('globex')(globexAdmin, { playbook: 'gamma', name: 'Gamma' }));
    await call(retirePlaybook, toOrg('globex')(globexAdmin, { playbook: 'gamma' }));

    expect(await run(calling(ping, globexAdmin, 'globex', 'gamma'))).toEqual({ status: 'succeeded', output: {} });
  });

  it('refuses a command with the conflict update_playbook gives for a retired playbook', async () => {
    const { call, run } = harness(ledgerPlaybookRegistry);
    await call(createPlaybook, toAcme(acmeAdmin, { playbook: 'alpha', name: 'Alpha' }));
    await call(createPlaybook, toOrg('globex')(globexAdmin, { playbook: 'gamma', name: 'Gamma' }));
    await call(retirePlaybook, toOrg('globex')(globexAdmin, { playbook: 'gamma' }));

    expect(await run(calling(poke, acmeAdmin, 'acme', 'alpha'))).toEqual({ status: 'succeeded', output: {} });
    expect(await run(calling(poke, globexAdmin, 'globex', 'gamma'))).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: anyWords,
      kind: 'retired',
    });
  });
});
