import { makeDispatcher, type CallerIdentity, type Outcome, type RouteRegistration } from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { defineListConnectionTools, defineSearchInOrg, type OfferedProvider } from '../index.ts';
import { fakeConnections } from '../testing/fake-connections.ts';
import { patientTiming } from '../testing/index.ts';
import { reportingAccess } from '../testing/reporting-access.ts';
import { fakeApiKey, serveFakeMcp } from '../testing/served-fakes.ts';

const adder: CallerIdentity = {
  id: 'acme-adder',
  name: 'acme-adder',
  org: 'acme',
  permissions: ['org:read', 'org:write'],
  playbooks: '*',
};

const payments: OfferedProvider = {
  name: 'payments',
  title: 'Payments',
  description: 'Refunds charges and pays out balances.',
  handles_money: true,
};

const tracker: OfferedProvider = {
  name: 'tracker',
  title: 'Tracker',
  description: 'Reads the issues of a team.',
  more: [{ name: 'admin', for: 'Change the statuses a team moves its issues through.' }],
};

const services = Layer.mergeAll(memoryLedger().layer, memoryPlaybookRegistry([]), recordingReporter().layer);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function connectedPayments() {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const connections = fakeConnections();
  connections.connect('acme', {
    id: 'payments-id',
    name: 'payments',
    environment: { GRAPH_API_KEY: fakeApiKey },
    entry: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, handles_money: true },
  });
  const { access } = reportingAccess({}, { timing: patientTiming, connections });
  closing.push(access.close);
  return access;
}

function dispatchedBy(registration: RouteRegistration<'org'>) {
  return (input: unknown, listed: boolean): Promise<Outcome> =>
    Effect.runPromise(
      makeDispatcher([])
        .dispatchToOrg(registration, {
          caller: adder,
          org: 'acme',
          input,
          encoding: 'strings',
          ...(listed ? { directoryListing: true } : {}),
        })
        .pipe(Effect.provide(services)),
    );
}

describe('the search of the org through the directory listing', () => {
  it('lists no provider and no server whose tools handle money, which it lists elsewhere, and keeps the groups of more a provider offers', async () => {
    const access = await connectedPayments();
    const searched = dispatchedBy(
      defineSearchInOrg(
        access,
        () => Effect.void,
        () => Effect.succeed([payments, tracker]),
      ).registration,
    );

    expect([await searched({}, true), await searched({}, false)]).toMatchObject([
      { status: 'succeeded', output: { servers: [], providers: [tracker] } },
      {
        status: 'succeeded',
        output: {
          servers: [{ name: 'payments' }],
          providers: [{ name: 'payments', title: 'Payments', description: payments.description }, tracker],
        },
      },
    ]);
  });

  it('lists no provider where the caller is offered none', async () => {
    const access = await connectedPayments();
    const searched = dispatchedBy(
      defineSearchInOrg(
        access,
        () => Effect.void,
        () => Effect.undefined,
      ).registration,
    );

    expect(await searched({}, true)).toEqual({
      status: 'succeeded',
      output: { servers: [], tools: [], scopes: [] },
    });
  });
});

describe('the tools of a connection through the directory listing', () => {
  it('are refused where its tools handle money, and listed elsewhere', async () => {
    const listed = dispatchedBy(defineListConnectionTools(await connectedPayments()).registration);

    expect([await listed({ id: 'payments-id' }, true), await listed({ id: 'payments-id' }, false)]).toMatchObject([
      {
        status: 'rejected',
        reason: 'unavailable',
        kind: 'tool_not_offered',
        detail:
          'The directory listing does not offer the tool server payments, whose tools pay, refund, transfer or pay out money',
      },
      { status: 'succeeded', output: { server: 'payments' } },
    ]);
  });
});
