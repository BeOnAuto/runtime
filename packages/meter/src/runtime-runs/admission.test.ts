import { ok } from 'node:assert/strict';

import type { RunDispatch } from '@on.auto/definitions';
import { statement } from '@on.auto/ledger';
import { Conflict, Unavailable } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { selfHostedRuns, type OfflineReservation } from '../index.ts';
import { assertOfflineConservation } from '../offline-testing/fixture.ts';
import { dispatchRequest, runtimeFixture } from '../runtime-testing/fixture.ts';

describe('the identity of a metered Runtime run', () => {
  it('normalizes UUID case and JSON object order while preserving array order and values', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const run = dispatchRequest({ input: { z: [null, false, { b: 2, a: 1 }], a: 'value' } });
    await Effect.runPromise(f.runs.admission.dispatch(run));
    await Effect.runPromise(
      f.runs.admission.dispatch({
        ...run,
        runId: run.runId.toUpperCase(),
        input: { a: 'value', z: [null, false, { a: 1, b: 2 }] },
      }),
    );
    const denied = await Effect.runPromise(
      Effect.flip(f.runs.admission.dispatch({ ...run, input: { a: 'value', z: [false, null, { a: 1, b: 2 }] } })),
    );
    expect(denied).toBeInstanceOf(Conflict);
    expect(denied.detail).toContain('different approved');
    expect(await f.options.connection.read(statement`SELECT id FROM meter_offline_charges`)).toHaveLength(1);
  });

  it('keeps the organization and playbook in the charge identity', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    await Effect.runPromise(f.runs.admission.dispatch(dispatchRequest()));
    await Effect.runPromise(f.runs.admission.dispatch(dispatchRequest({ org: 'globex' })));
    await Effect.runPromise(f.runs.admission.dispatch(dispatchRequest({ playbook: 'beta' })));

    expect(await f.options.connection.read(statement`SELECT id FROM meter_offline_charges`)).toHaveLength(3);
    await assertOfflineConservation(f.options.connection);
  });
});

describe('approval stays bound to the work', () => {
  it('refuses a changed definition, source, input, capability or limits under the same run ID', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const run = dispatchRequest();
    await Effect.runPromise(f.runs.admission.dispatch(run));
    const changes = [
      { ...run, definition: { ...run.definition, name: 'other' } },
      { ...run, definition: { ...run.definition, version: 2 } },
      { ...run, definition: { ...run.definition, source: `${run.definition.source}\n` } },
      { ...run, definition: { ...run.definition, type: 'recall' } },
      { ...run, input: { value: 4 } },
    ];
    const refused = await Promise.all(
      changes.map((changed: RunDispatch) => Effect.runPromise(Effect.flip(f.runs.admission.dispatch(changed)))),
    );
    expect(refused.map((error: Readonly<{ detail: string }>) => error.detail)).toEqual(
      Array.from(
        { length: 5 },
        () => 'This run ID already has a different approved definition, input or limits; use a new run ID.',
      ),
    );
    const limits = { ...f.runOptions.limits, computation: { ...f.runOptions.limits.computation, budget: 21_000 } };
    const changed = selfHostedRuns({ ...f.runOptions, limits });
    expect((await Effect.runPromise(Effect.flip(changed.admission.dispatch(run)))).detail).toContain(
      'different approved',
    );
  });

  it('captures the configured limits and admission methods when composed', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const limits = structuredClone(f.runOptions.limits);
    const accounting = { ...f.meter.accounting };
    const runs = selfHostedRuns({ ...f.runOptions, meter: { ...f.meter, accounting }, limits });
    Reflect.set(limits.computation, 'budget', 0);
    accounting.reserve = () => Promise.reject(new Error('replaced after composition'));
    await Effect.runPromise(runs.admission.dispatch(dispatchRequest()));
    await Effect.runPromise(f.runs.admission.dispatch(dispatchRequest()));
    expect(await f.options.connection.read(statement`SELECT id FROM meter_offline_charges`)).toHaveLength(1);
  });
});

describe('finite Runtime limits and scope', () => {
  it.each([
    [null, 'approved bound'],
    ['question', 'approved bound'],
    [{}, 'approved bound'],
    [{ build: {} }, 'only in Auto Cloud'],
  ] as const)('checks prediction scope before an adapter can start local training: %#', async (input, detail) => {
    const f = await runtimeFixture();
    const run = dispatchRequest({ input, definition: { ...dispatchRequest().definition, type: 'prediction' } });
    const check = f.runs.admission.check;
    ok(check !== undefined);
    expect((await Effect.runPromise(Effect.flip(check(run)))).detail).toContain(detail);
    expect((await Effect.runPromise(Effect.flip(f.runs.admission.dispatch(run)))).detail).toContain(detail);
    expect(await f.options.connection.read(statement`SELECT id FROM meter_reservations`)).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'refuses an invalid run bound %s before reserving',
    async (budget) => {
      const f = await runtimeFixture();
      await f.meter.license.activate('activation-secret');
      const limits = { ...f.runOptions.limits, computation: { ...f.runOptions.limits.computation, budget } };
      const runs = selfHostedRuns({ ...f.runOptions, limits });
      expect(await Effect.runPromise(Effect.flip(runs.admission.dispatch(dispatchRequest())))).toBeInstanceOf(
        Unavailable,
      );
      expect(await f.options.connection.read(statement`SELECT id FROM meter_reservations`)).toEqual([]);
    },
  );

  it('refuses malformed scope or run IDs before reserving', async () => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    const rejected = await Promise.all(
      [
        dispatchRequest({ runId: 'not-a-uuid' }),
        dispatchRequest({ org: 'a:b' }),
        dispatchRequest({ playbook: 'a:b' }),
      ].map((run) => Effect.runPromise(Effect.flip(f.runs.admission.dispatch(run)))),
    );
    expect(rejected.every((error: unknown) => error instanceof Unavailable)).toBe(true);
    expect(await f.options.connection.read(statement`SELECT id FROM meter_reservations`)).toEqual([]);
  });
});

const corrupted = [
  (reservation: OfflineReservation): OfflineReservation => ({ ...reservation, maximumUnits: 2_000_000n }),
  (reservation: OfflineReservation): OfflineReservation => ({ ...reservation, capabilities: [] }),
  (reservation: OfflineReservation): OfflineReservation => ({ ...reservation, capabilities: ['recall'] }),
];

describe('the stored approval boundary', () => {
  it.each(corrupted)('refuses a different stored amount or capability', async (change) => {
    const f = await runtimeFixture();
    await f.meter.license.activate('activation-secret');
    await Effect.runPromise(f.runs.admission.dispatch(dispatchRequest()));
    const reservation = f.meter.accounting.reservation;
    const altered = selfHostedRuns({
      ...f.runOptions,
      meter: {
        ...f.meter,
        accounting: {
          ...f.meter.accounting,
          reservation: async (id) => {
            const stored = await reservation(id);
            ok(stored !== undefined);
            return change(stored);
          },
        },
      },
    });
    expect((await Effect.runPromise(Effect.flip(altered.admission.dispatch(dispatchRequest())))).detail).toContain(
      'different approved',
    );
    expect(await f.options.connection.read(statement`SELECT id FROM meter_offline_charges`)).toHaveLength(1);
  });
});
