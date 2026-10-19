import type { Outcome } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { relay } from '../testing/capabilities/relay.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { asQueryString, harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const callerChosen = 'ffffffff-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const hashedChild = '6b1e2f30-9c4d-5a8b-8e7f-0a1b2c3d4e5f';

const startedTwice = '00000000-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const listedIdsOf = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({ runs: Schema.Array(Schema.Struct({ run_id: Schema.String })) }),
  }),
);

function idStartsIn(outcome: Outcome): readonly string[] {
  return listedIdsOf(outcome).output.runs.map(({ run_id: id }) => id.slice(0, 8));
}

type DefinitionName = readonly [type: string, name: string];

const greet: DefinitionName = ['echo', 'greet'];

const wave: DefinitionName = ['echo', 'wave'];

const plain: DefinitionName = ['probe', 'plain'];

const handOn: DefinitionName = ['relay', 'hand-on'];

async function playbookWithRuns() {
  const prober = probe();
  const relayer = relay();
  const operations = definitionOperationsFor([echo, prober.capability, relayer.capability]);
  const definitions = harness();
  const creating = (type: string, name: string, source: string) =>
    definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { type, name, source }));
  await creating('echo', 'greet', '{"greeting":"Hi"}');
  await creating('echo', 'wave', '{"greeting":"Hey"}');
  await creating('probe', 'plain', 'plain');
  await creating('relay', 'hand-on', 'text');
  const running = ([type, name]: DefinitionName, input: object, runId: string, at: string) =>
    definitions.call(operations.runDefinition, toAlpha(acmeAdmin, { type, name, input, run_id: runId }), at);
  const listing = (input: object = {}) => definitions.call(operations.listRuns, toAlpha(acmeAdmin, input));
  return { ...definitions, ...operations, prober, running, listing };
}

async function playbookWithEveryEnding() {
  const playbook = await playbookWithRuns();
  const { running, prober } = playbook;
  await running(greet, { who: 'Ada' }, callerChosen, '2026-10-01T09:01:00.000Z');
  await running(plain, { reject: true }, hashedChild, '2026-10-01T09:02:00.000Z');
  prober.sufferOnNextRun('unavailable');
  await running(plain, {}, startedTwice, '2026-10-01T09:03:00.000Z');
  await running(handOn, {}, '22222222-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:04:00.000Z');
  prober.sufferOnNextRun('breakdown');
  await running(plain, {}, '33333333-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:05:00.000Z');
  await running(wave, {}, '44444444-7d2e-7c1a-9b3f-2f1e0d9c8b7a', '2026-10-01T09:06:00.000Z');
  await running(plain, {}, startedTwice, '2026-10-01T09:07:00.000Z');
  return playbook;
}

const everyEndingNewestFirst = [
  {
    run_id: '44444444-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    type: 'echo',
    name: 'wave',
    definition_version: 1,
    status: 'succeeded',
    started_at: '2026-10-01T09:06:00.000Z',
    started_by: 'acme-admin',
    finished_at: '2026-10-01T09:06:00.000Z',
  },
  {
    run_id: '33333333-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    type: 'probe',
    name: 'plain',
    definition_version: 1,
    status: 'failed',
    started_at: '2026-10-01T09:05:00.000Z',
    started_by: 'acme-admin',
    finished_at: '2026-10-01T09:05:00.000Z',
  },
  {
    run_id: '22222222-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    type: 'relay',
    name: 'hand-on',
    definition_version: 1,
    status: 'started',
    started_at: '2026-10-01T09:04:00.000Z',
    started_by: 'acme-admin',
  },
  {
    run_id: startedTwice,
    type: 'probe',
    name: 'plain',
    definition_version: 1,
    status: 'succeeded',
    started_at: '2026-10-01T09:03:00.000Z',
    started_by: 'acme-admin',
    finished_at: '2026-10-01T09:07:00.000Z',
  },
  {
    run_id: hashedChild,
    type: 'probe',
    name: 'plain',
    definition_version: 1,
    status: 'rejected',
    rejection: { reason: 'invalid_input' },
    started_at: '2026-10-01T09:02:00.000Z',
    started_by: 'acme-admin',
    finished_at: '2026-10-01T09:02:00.000Z',
  },
  {
    run_id: callerChosen,
    type: 'echo',
    name: 'greet',
    definition_version: 1,
    status: 'succeeded',
    started_at: '2026-10-01T09:01:00.000Z',
    started_by: 'acme-admin',
    finished_at: '2026-10-01T09:01:00.000Z',
  },
];

describe('list_runs', () => {
  it('is a playbook query at GET /runs that names the capabilities it may filter by', () => {
    const { listRuns } = definitionOperationsFor([echo, probe().capability]);

    expect(listRuns.registration).toMatchObject({
      scope: 'playbook',
      kind: 'query',
      title: 'List runs',
      route: { method: 'GET', path: '/runs' },
      reasons: ['invalid_input'],
    });
    expect(listRuns.registration.input.schema).toMatchObject({
      properties: {
        type: {
          type: 'string',
          enum: ['echo', 'probe'],
          description: 'Only the runs of this type',
        },
      },
    });
  });

  it('lists the runs newest first by their first start, whatever their ids, without outputs, records or issues', async () => {
    const { listing } = await playbookWithEveryEnding();

    expect(await listing()).toEqual({
      status: 'succeeded',
      output: {
        runs: everyEndingNewestFirst,
        has_more: false,
        next_cursor: null,
      },
    });
  });
});

describe('a run listed after it started again', () => {
  it('shows a run started again and still running by its latest start, in the place of its first', async () => {
    const { callCancelledWhen, runDefinition, running, listing, prober, call, updateDefinition } =
      await playbookWithRuns();
    prober.sufferOnNextRun('unavailable');
    await running(plain, {}, startedTwice, '2026-10-01T09:01:00.000Z');
    await running(greet, {}, callerChosen, '2026-10-01T09:02:00.000Z');
    await call(updateDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'newer' }));
    prober.sufferOnNextRun('stall');
    const finishing = Promise.withResolvers<void>();
    const again = toAlpha(acmeAdmin, { type: 'probe', name: 'plain', input: {}, run_id: startedTwice });
    const runningAgain = callCancelledWhen(finishing.promise, runDefinition, again);
    await prober.stalled;

    const listed = await listing();
    finishing.resolve();
    await runningAgain;

    expect(listed).toMatchObject({
      output: {
        runs: [
          { run_id: callerChosen },
          { run_id: startedTwice, status: 'started', definition_version: 2, started_at: '2026-10-01T09:00:00.000Z' },
        ],
      },
    });
  });
});

describe('a run listed after it did not go through', () => {
  it('shows the reason, kind and because of a rejection, and never its detail', async () => {
    const { running, listing, prober } = await playbookWithRuns();
    prober.sufferOnNextRun('unoffered');
    await running(plain, {}, callerChosen, '2026-10-01T09:01:00.000Z');
    prober.sufferOnNextRun('unworkable');
    await running(plain, {}, hashedChild, '2026-10-01T09:02:00.000Z');
    prober.sufferOnNextRun('unavailable');
    await running(plain, {}, startedTwice, '2026-10-01T09:03:00.000Z');

    expect(await listing()).toMatchObject({
      output: {
        runs: [
          { run_id: startedTwice, rejection: { reason: 'unavailable' } },
          { run_id: hashedChild, rejection: { reason: 'conflict', kind: 'unworkable' } },
          {
            run_id: callerChosen,
            rejection: { reason: 'unavailable', kind: 'model_not_offered', because: 'provider_not_configured' },
          },
        ],
      },
    });
  });
});

describe('a conflict in the list of runs', () => {
  it('shows its reason alone when it has no kind', async () => {
    const { running, listing, prober } = await playbookWithRuns();
    prober.sufferOnNextRun('conflict');
    await running(plain, {}, callerChosen, '2026-10-01T09:01:00.000Z');

    expect(await listing()).toMatchObject({
      output: { runs: [{ run_id: callerChosen, rejection: { reason: 'conflict' } }] },
    });
    expect(await listing()).not.toMatchObject({ output: { runs: [{ rejection: { kind: 'unworkable' } }] } });
  });
});

describe('list_runs filtering', () => {
  it.each([
    [{ status: 'succeeded' }, ['44444444', '00000000', 'ffffffff']],
    [{ status: 'rejected' }, ['6b1e2f30']],
    [{ status: 'failed' }, ['33333333']],
    [{ status: 'started' }, ['22222222']],
    [{ type: 'echo' }, ['44444444', 'ffffffff']],
    [{ name: 'plain' }, ['33333333', '00000000', '6b1e2f30']],
    [{ type: 'probe', name: 'plain', status: 'succeeded' }, ['00000000']],
    [{ type: 'echo', name: 'plain' }, []],
  ] as const)('keeps the runs %j', async (filters, kept) => {
    const { listing } = await playbookWithEveryEnding();

    const listed = await listing(filters);

    expect(listed).toMatchObject({ status: 'succeeded', output: { has_more: false, next_cursor: null } });
    expect(idStartsIn(listed)).toEqual(kept);
  });

  it('refuses a type the server does not run, naming the types it runs', async () => {
    const { listing } = await playbookWithEveryEnding();

    expect(await listing({ type: 'gone' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/type', detail: 'Expected a type this server runs: echo, probe, or relay' }],
    });
  });

  it('reads its filters, limit and cursor from a query string', async () => {
    const { call, listRuns } = await playbookWithEveryEnding();

    expect(await call(listRuns, asQueryString(toAlpha(acmeAdmin, { status: 'succeeded', limit: '1' })))).toMatchObject({
      status: 'succeeded',
      output: { runs: [{ run_id: '44444444-7d2e-7c1a-9b3f-2f1e0d9c8b7a' }], has_more: true },
    });
  });

  it('refuses a status, name or limit it does not know', async () => {
    const { listing } = await playbookWithRuns();

    expect(await listing({ status: 'deferred', name: 'No', limit: 0 })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/name' }, { pointer: '/status' }, { pointer: '/limit' }],
    });
  });
});

describe('the runs of a playbook', () => {
  it('are its own alone', async () => {
    const { listing, call, listRuns } = await playbookWithEveryEnding();

    expect(await call(listRuns, toPlaybook('globex', 'gamma')(globexAdmin))).toEqual({
      status: 'succeeded',
      output: { runs: [], has_more: false, next_cursor: null },
    });
    expect(await call(listRuns, toPlaybook('acme', 'beta')(acmeAdmin))).toMatchObject({
      output: { runs: [] },
    });
    expect(await listing()).toMatchObject({ output: { runs: { length: 6 } } });
  });
});
