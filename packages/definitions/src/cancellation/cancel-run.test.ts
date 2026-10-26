import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCancelRun } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { firstMoment, toPlaybook } from '../testing/harness.ts';
import { cancelledAt, relayedId, withHandOn } from '../testing/relaying.ts';

const asStarted = {
  run_id: relayedId,
  type: 'relay',
  name: 'hand-on',
  definition_version: 1,
  status: 'started',
  started_at: firstMoment,
  started_by: { id: 'acme-admin', name: 'acme-admin' },
};

const everything = { kind: 'everything' } as const;

describe('cancel_run', () => {
  it('records the request on a run that finishes later, with its caller and reason, and answers the run as it stands', async () => {
    const { cancelling, running, history } = await withHandOn();
    await running();

    expect(await cancelling({ reason: 'Not needed any more' })).toStrictEqual({
      status: 'succeeded',
      output: asStarted,
    });
    expect(await history()).toMatchObject({
      output: {
        events: [
          { type: 'run_started' },
          {
            type: 'run_cancel_requested',
            summary: 'Someone allowed to change the playbook asked for the run to be cancelled.',
            data: { kind: 'requested', reason: 'Not needed any more' },
            metadata: { at: cancelledAt, run_id: relayedId, by: 'acme-admin' },
          },
        ],
      },
    });
  });
});

describe('cancel_run asked again, or without a reason', () => {
  it('says who asked when no reason is given, and records nothing more when asked again before the run ended', async () => {
    const { cancelling, running, ledger, run } = await withHandOn();
    await running();
    await cancelling();
    await cancelling({ reason: 'Asked again' });

    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded({ org: 'acme', playbook: 'alpha' }, everything, { order: 'asc', limit: 20 }),
      ),
    );

    expect(
      records.filter(({ type }) => type === 'run_cancel_requested').map(({ data, context }) => [data, context]),
    ).toEqual([
      [
        { kind: 'requested', reason: 'Cancelled at the request of acme-admin' },
        {
          at: cancelledAt,
          by: 'acme-admin',
          runId: relayedId,
          definitionType: 'relay',
          definitionName: 'hand-on',
          definitionVersion: 1,
        },
      ],
    ]);
  });
});

describe('a cancel request on a run', () => {
  it('is put in the tree of the run, caused by nothing, as a request from outside is', async () => {
    const { cancelling, running, ledger, run } = await withHandOn();
    await running();
    await cancelling();

    const { records } = await run(
      Effect.orDie(
        ledger.service.readRecorded({ org: 'acme', playbook: 'alpha' }, everything, { order: 'asc', limit: 20 }),
      ),
    );

    expect(records.at(-1)).toMatchObject({
      type: 'run_cancel_requested',
      causationId: null,
      correlationId: relayedId,
    });
  });

  it('is a conflict for a run that has ended, and for one that runs within its call', async () => {
    const { call, cancelling, runDefinition, running, prober, settling } = await withHandOn();
    await running();
    await settling({ status: 'succeeded', output: 'handed on', record: {} });
    const plain = '0199a3c4-7d2e-7c1a-9b3f-000000000001';
    prober.sufferOnNextRun('stall');
    void call(runDefinition, toPlaybook('acme', 'alpha')(acmeAdmin, { type: 'probe', name: 'plain', run_id: plain }));
    await prober.stalled;

    expect([await cancelling(), await cancelling({}, plain)]).toEqual([
      {
        status: 'rejected',
        reason: 'conflict',
        detail: 'The run has already ended, so there is nothing left to cancel',
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail:
          'The run takes place within the call that started it, which no server can interrupt from outside, so it cannot be cancelled; it ends when that call does',
      },
    ]);
  });
});

describe('cancel_run of a run the playbook does not have, or with a reason it cannot keep', () => {
  it('is not found', async () => {
    const { cancelling } = await withHandOn();

    expect(await cancelling({}, '0199a3c4-7d2e-7c1a-9b3f-00000000ffff')).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no such run in this playbook',
    });
  });

  it('refuses a reason that is blank, too long or holds a control character', async () => {
    const { cancelling, running } = await withHandOn();
    await running();

    const refusals = [
      await cancelling({ reason: '   ' }),
      await cancelling({ reason: 'x'.repeat(1025) }),
      await cancelling({ reason: 'stop\u0007' }),
    ];

    expect(refusals).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/reason' }] },
    ]);
  });
});

describe('the operation of cancelling a run', () => {
  const { registration } = defineCancelRun([echo]);

  it('is a playbook command at POST /runs/{run_id}/cancel that may be rejected as not found or a conflict', () => {
    expect(registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      name: 'cancel_run',
      title: 'Cancel run',
      route: { method: 'POST', path: '/runs/{run_id}/cancel' },
      reasons: ['not_found', 'conflict'],
    });
  });

  it('says in plain words what it tried and that the run is being cancelled', () => {
    expect([
      registration.plainLanguage?.attempt({ run_id: relayedId }),
      registration.plainLanguage?.outcome({ ...asStarted, type: 'echo', name: 'greet' }, { run_id: relayedId }),
    ]).toEqual([
      'cancel the run',
      'The greeting “greet” is being cancelled: it ends as cancelled within a moment, unless it finishes first, and how it ended can be looked up then.',
    ]);
  });
});
