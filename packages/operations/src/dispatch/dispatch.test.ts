import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineQuery, DirectoryListing, OperationsServed, ServedAsTool, settle } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toOrg, toPlaybook } from '../testing/harness.ts';
import { breakOnceLeft, giveUp, linger } from '../testing/misbehaving.ts';
import { peekOrgCommand, peekOrgQuery, peekPlaybookCommand, peekPlaybookQuery } from '../testing/probes.ts';

const servedAsTool = Effect.gen(function* () {
  return yield* ServedAsTool;
});

describe('whether a call is served as a tool', () => {
  it('is not unless the server serving it says so', () => {
    expect(Effect.runSync(servedAsTool)).toBe(false);
    expect(Effect.runSync(servedAsTool.pipe(Effect.provideService(ServedAsTool, true)))).toBe(true);
  });
});

const servesTheSearch = Effect.gen(function* () {
  const serves = yield* OperationsServed;
  return serves('search');
});

describe('the operations served beside a call', () => {
  it('are every operation unless the server serving it names them', () => {
    expect(Effect.runSync(servesTheSearch)).toBe(true);
    expect(
      Effect.runSync(servesTheSearch.pipe(Effect.provideService(OperationsServed, (name) => name === 'get_guide'))),
    ).toBe(false);
  });
});

describe('a handler at run time', () => {
  it('sees the caller, the address and the ports of its call, with the writer for commands only', async () => {
    const { dispatcher, run } = harness();
    const toAcme = toOrg('acme');
    const toAlpha = toPlaybook('acme', 'alpha');
    const view = { caller: 'acme-admin', org: 'acme' };
    const inAlpha = { ...view, playbook: 'alpha', status: 'active' };

    expect(await run(dispatcher.dispatchToOrg(peekOrgQuery.registration, toAcme(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { ...view, visible: ['Caller', 'OrgContext', 'OrgReader'] },
    });
    expect(await run(dispatcher.dispatchToOrg(peekOrgCommand.registration, toAcme(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { ...view, visible: ['Caller', 'OrgContext', 'OrgReader', 'OrgWriter'] },
    });
    expect(await run(dispatcher.dispatchToPlaybook(peekPlaybookQuery.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { ...inAlpha, visible: ['Caller', 'PlaybookContext', 'PlaybookLifecycle', 'PlaybookReader'] },
    });
    expect(await run(dispatcher.dispatchToPlaybook(peekPlaybookCommand.registration, toAlpha(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: {
        ...inAlpha,
        visible: ['Caller', 'PlaybookContext', 'PlaybookLifecycle', 'PlaybookReader', 'PlaybookWriter'],
      },
    });
  });

  it('sees the status of its playbook as the registry gives it, retired for a query that a retired playbook answers', async () => {
    const { dispatcher, run } = harness({ retiredPlaybooks: [{ org: 'acme', playbook: 'old' }] });

    expect(
      await run(dispatcher.dispatchToPlaybook(peekPlaybookQuery.registration, toPlaybook('acme', 'old')(acmeAdmin))),
    ).toMatchObject({
      status: 'succeeded',
      output: { playbook: 'old', status: 'retired' },
    });
  });
});

const answering = {
  title: 'Listing',
  description: 'Answers whether it serves the directory listing. Use it to see the listing. It changes nothing.',
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ directory: Schema.Boolean }),
  reasons: [],
  handle: Effect.fnUntraced(function* () {
    return { directory: yield* DirectoryListing };
  }),
};

const inTheOrg = defineQuery('org', { ...answering, name: 'org_listing', route: { method: 'GET', path: '/listing' } });

const inAPlaybook = defineQuery('playbook', {
  ...answering,
  name: 'playbook_listing',
  route: { method: 'GET', path: '/listing' },
});

describe('the directory listing of a call', () => {
  it('reaches an operation of the org or of a playbook when the request names it, and is false otherwise', async () => {
    const { dispatcher, run } = harness();
    const listed: { readonly directoryListing: true } = { directoryListing: true };

    const answers = await Promise.all([
      run(dispatcher.dispatchToOrg(inTheOrg.registration, { ...toOrg('acme')(acmeAdmin), ...listed })),
      run(dispatcher.dispatchToOrg(inTheOrg.registration, toOrg('acme')(acmeAdmin))),
      run(
        dispatcher.dispatchToPlaybook(inAPlaybook.registration, {
          ...toPlaybook('acme', 'alpha')(acmeAdmin),
          ...listed,
        }),
      ),
      run(dispatcher.dispatchToPlaybook(inAPlaybook.registration, toPlaybook('acme', 'alpha')(acmeAdmin))),
    ]);

    expect(answers).toMatchObject([
      { status: 'succeeded', output: { directory: true } },
      { status: 'succeeded', output: { directory: false } },
      { status: 'succeeded', output: { directory: true } },
      { status: 'succeeded', output: { directory: false } },
    ]);
  });
});

describe('the directory listing outside a call', () => {
  it('is false where no request names it', () => {
    expect(
      Effect.runSync(
        Effect.gen(function* () {
          return yield* DirectoryListing;
        }),
      ),
    ).toBe(false);
  });
});

const toAlpha = toPlaybook('acme', 'alpha');

describe('a settled call', () => {
  it('is the outcome of a call that finishes', async () => {
    const { dispatcher, run } = harness();
    const quick = dispatcher.dispatchToPlaybook(linger.registration, toAlpha(acmeAdmin, { milliseconds: 0 }));

    expect(await run(settle(quick, new AbortController().signal))).toEqual({
      status: 'succeeded',
      output: { lingered: 0 },
    });
    expect(await run(settle(quick))).toEqual({ status: 'succeeded', output: { lingered: 0 } });
  });

  it('is cancelled when the signal aborts the call, and nothing is reported', async () => {
    const { dispatcher, reported, settleAbortedWhileItRuns } = harness();
    const slow = dispatcher.dispatchToPlaybook(linger.registration, toAlpha(acmeAdmin, { milliseconds: 60_000 }));

    expect({ settled: await settleAbortedWhileItRuns(slow), reported: reported() }).toEqual({
      settled: { status: 'cancelled' },
      reported: [],
    });
  });

  it('is cancelled at once when the signal has already aborted', async () => {
    const { dispatcher, run } = harness();
    const slow = dispatcher.dispatchToPlaybook(linger.registration, toAlpha(acmeAdmin, { milliseconds: 60_000 }));

    expect(await run(settle(slow, AbortSignal.abort()))).toEqual({ status: 'cancelled' });
  });

  it('is cancelled when the call interrupts itself, which is not a failure', async () => {
    const { dispatcher, reported, run } = harness();

    expect({
      settled: await run(settle(dispatcher.dispatchToPlaybook(giveUp.registration, toAlpha(acmeAdmin)))),
      reported: reported(),
    }).toEqual({ settled: { status: 'cancelled' }, reported: [] });
  });

  it('fails with a reported incident for any other failure', async () => {
    const { reported, run } = harness();

    const settled = await run(settle(Effect.die(new Error('escaped the call'))));

    expect(settled).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(reported()).toEqual([{ id: reported()[0]?.id, original: new Error('escaped the call') }]);
  });
});

describe('a call whose signal aborts it', () => {
  it('is cancelled, and a defect the call raises after that is still reported as an incident', async () => {
    const { dispatcher, reported, settleAbortedWhileItRuns } = harness();
    const breaking = dispatcher.dispatchToPlaybook(breakOnceLeft.registration, toAlpha(acmeAdmin));

    expect(await settleAbortedWhileItRuns(breaking)).toEqual({ status: 'cancelled' });
    expect(reported()).toEqual([
      {
        id: reported()[0]?.id,
        original: new Error('broken after its caller left'),
        call: { operation: 'break_once_left', org: 'acme', playbook: 'alpha', caller: 'acme-admin' },
      },
    ]);
  });
});
