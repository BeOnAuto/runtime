import { workflowFacts } from '@on.auto/coordination';
import { nudging } from '@on.auto/interaction/testing';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { PlaybookRegistry, allPermissions, makeDispatcher, type CallerIdentity } from '@on.auto/operations';
import { createPlaybook } from '@on.auto/playbooks';
import { Context, Effect, Layer, ManagedRuntime } from 'effect';
import { describe, expect, it } from 'vitest';

import { logsToStderr } from '../logging/log-formats.ts';
import { applicationLayer } from './application-layer.ts';
import { factsComposedOf } from './composed-facts.ts';

const acmeAdmin: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

const statusOfAlpha = Effect.gen(function* () {
  const registry = yield* PlaybookRegistry;
  return yield* registry.status({ org: 'acme', playbook: 'alpha' });
});

describe('the services the playbook operations run on', () => {
  it('are the only services at the top level of the runtime, beside Effect’s own', async () => {
    const runtime = ManagedRuntime.make(
      applicationLayer(ledgerLayer({ fileName: ':memory:' })).pipe(Layer.provideMerge(logsToStderr('json'))),
    );

    const keys = [...(await runtime.context()).mapUnsafe.keys()];
    await runtime.dispose();

    expect(keys.filter((key) => !key.startsWith('effect/')).toSorted()).toEqual([
      '@on.auto/definitions/LiveAttempts',
      '@on.auto/definitions/RunMeter',
      '@on.auto/ledger/LedgerChores',
      '@on.auto/ledger/LedgerConnection',
      '@on.auto/ledger/LedgerLog',
      '@on.auto/meter/LicensedFeatures',
      '@on.auto/meter/RuntimeLicense',
      '@on.auto/operations/IncidentReporter',
      '@on.auto/operations/Ledger',
      '@on.auto/operations/PlaybookRegistry',
    ]);
  });

  it('share one ledger, so the playbook registry finds a playbook the operations created', async () => {
    const runtime = ManagedRuntime.make(applicationLayer(ledgerLayer({ fileName: ':memory:' })));
    const created = makeDispatcher([]).dispatchToOrg(createPlaybook.registration, {
      caller: acmeAdmin,
      org: 'acme',
      input: { playbook: 'alpha', name: 'Alpha' },
      encoding: 'json',
    });

    const outcome = await runtime.runPromise(created);
    const status = await runtime.runPromise(statusOfAlpha);
    await runtime.dispose();

    expect({ outcome: outcome.status, status }).toEqual({ outcome: 'succeeded', status: 'active' });
  });
});

const runsNothing = {
  run: () => Promise.reject(new Error('The facts are composed before anything runs')),
  dispose: () => Promise.resolve(),
  context: Context.empty(),
};

describe('the facts the server composes from its capabilities and the workflow’s, as it starts', () => {
  it('are refused, and the server does not start, when a fact or a stream kind is declared twice or a fact the playbook records itself, naming it and the capability', () => {
    const prodding = { ...nudging, type: 'prodding' };
    const claiming = {
      ...nudging,
      type: 'claiming',
      facts: { ...nudging.facts, onRuns: nudging.facts.onRuns.map((fact) => ({ ...fact, type: 'run_failed' })) },
    };
    const logging = { ...nudging, type: 'logging', facts: { onRuns: [], streams: workflowFacts.facts.streams } };

    expect(() => factsComposedOf(runsNothing, [nudging, prodding])).toThrow(
      'The fact nudge_sent is declared by the capabilities nudging and prodding, and one capability alone may declare it',
    );
    expect(() => factsComposedOf(runsNothing, [claiming])).toThrow(
      'The fact run_failed that the capability claiming declares is one the playbook records itself',
    );
    expect(() => factsComposedOf(runsNothing, [logging])).toThrow(
      'The stream kind run-logs is declared by the capabilities logging and workflow, and one capability alone may declare it',
    );
    expect(factsComposedOf(runsNothing, [nudging]).facts).toEqual({
      onRuns: nudging.facts.onRuns,
      streams: workflowFacts.facts.streams,
    });
  });
});
