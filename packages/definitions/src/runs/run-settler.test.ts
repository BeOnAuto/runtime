import { Conflict, NotFound, type RecordedEvent } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Settlement } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { firstMoment, toPlaybook } from '../testing/harness.ts';
import { relayedId, settledAt, withHandOn } from '../testing/relaying.ts';

const settled = {
  run_id: relayedId,
  type: 'relay',
  name: 'hand-on',
  definition_version: 1,
  started_at: firstMoment,
  started_by: { id: 'acme-admin', name: 'acme-admin' },
  finished_at: settledAt,
};

const success: Settlement = { status: 'succeeded', output: 'handed on', record: { steps: 3 } };

const noSuchRun = Result.fail(new NotFound({ detail: 'There is no such run in this playbook' }));

describe('settling a deferred run', () => {
  it('records its success, which a read and a call with its id then answer, without running it again', async () => {
    const { running, reading, relayer, settling } = await withHandOn();
    await running();

    expect(await settling(success)).toStrictEqual(
      Result.succeed({ ...settled, status: 'succeeded', output: 'handed on' }),
    );
    expect(await reading()).toStrictEqual({
      status: 'succeeded',
      output: { ...settled, status: 'succeeded', output: 'handed on', record: { steps: 3 } },
    });
    expect(await running()).toStrictEqual({
      status: 'succeeded',
      output: { ...settled, status: 'succeeded', output: 'handed on', record: { steps: 3 } },
    });
    expect(relayer.runs()).toBe(1);
  });

  it('is quiet when it is settled again the same way, and a conflict when settled another way', async () => {
    const { running, settling } = await withHandOn();
    await running();
    const first = await settling(success);

    expect(await settling(success)).toStrictEqual(first);
    expect(await settling({ status: 'failed' })).toEqual(
      Result.fail(new Conflict({ detail: 'The run already ended with another result' })),
    );
  });
});

describe('settling a deferred run as rejected or failed', () => {
  it('records a rejection of its input, which a call with its id answers again', async () => {
    const { running, relayer, settling } = await withHandOn();
    await running();

    expect(await settling({ status: 'rejected', reason: 'invalid_input', detail: 'No such customer' })).toMatchObject(
      Result.succeed({
        status: 'rejected',
        rejection: { reason: 'invalid_input', detail: 'No such customer', issues: [] },
      }),
    );
    expect(await running()).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'No such customer',
      issues: [],
    });
    expect(relayer.runs()).toBe(1);
  });

  it('records a conflict with its kind and because', async () => {
    const { running, settling } = await withHandOn();
    await running();
    const unknown = {
      reason: 'conflict',
      detail: 'It may have posted',
      kind: 'effect_unknown',
      because: 'tool_error',
    } as const;

    expect(await settling({ status: 'rejected', ...unknown })).toMatchObject(
      Result.succeed({ status: 'rejected', rejection: unknown }),
    );
  });

  it('as unavailable or failed lets a call with its id run it again', async () => {
    const { running, relayer, settling } = await withHandOn();
    await running();
    await settling({ status: 'rejected', reason: 'unavailable', detail: 'The worker is gone' });
    await running();
    await settling({ status: 'failed' });

    expect(await running()).toMatchObject({ output: { status: 'started' } });
    expect(relayer.runs()).toBe(3);
  });
});

describe('settling a run', () => {
  it('reaches only the run of its own org, playbook and id', async () => {
    const { running, settling } = await withHandOn();
    await running();

    expect(await settling(success, { org: 'acme', playbook: 'beta', id: relayedId })).toEqual(noSuchRun);
    expect(await settling(success, { org: 'globex', playbook: 'alpha', id: relayedId })).toEqual(noSuchRun);
    expect(
      await settling(success, { org: 'acme', playbook: 'alpha', id: '0199a3c4-7d2e-7c1a-9b3f-000000000000' }),
    ).toEqual(noSuchRun);
    expect(await settling(success, { org: 'acme', playbook: 'alpha', id: relayedId.toUpperCase() })).toMatchObject(
      Result.succeed({ run_id: relayedId, status: 'succeeded' }),
    );
  });

  it('is not found for an address that is not well formed', async () => {
    const { settling } = await withHandOn();

    expect(await settling(success, { org: 'ac/me', playbook: 'alpha', id: relayedId })).toEqual(noSuchRun);
    expect(await settling(success, { org: 'acme', playbook: 'alpha/../beta', id: relayedId })).toEqual(noSuchRun);
    expect(await settling(success, { org: 'acme', playbook: 'alpha', id: 'latest' })).toEqual(noSuchRun);
  });

  it('is a conflict for a run that ran within its call', async () => {
    const { call, runDefinition, settling } = await withHandOn();
    await call(
      runDefinition,
      toPlaybook('acme', 'alpha')(acmeAdmin, { type: 'probe', name: 'plain', run_id: relayedId }),
    );

    expect(await settling(success)).toEqual(
      Result.fail(new Conflict({ detail: 'The run already ended with another result' })),
    );
  });
});

describe('a settlement whose output is too large or is not JSON', () => {
  it('is a breakdown of the capability that fails the run', async () => {
    const { breakingDown, running, reading } = await withHandOn();
    await running();

    expect(await breakingDown({ status: 'succeeded', output: 'x'.repeat(1_048_576), record: {} })).toEqual(
      new Error('The capability answered with 1048580 bytes to record, more than the 1048576 allowed'),
    );
    expect(await reading()).toMatchObject({ output: { status: 'failed', finished_at: settledAt } });
  });

  it('is a breakdown as well when the output is not JSON', async () => {
    const { breakingDown, running, reading } = await withHandOn();
    await running();

    expect(Schema.isSchemaError(await breakingDown({ status: 'succeeded', output: Number.NaN, record: {} }))).toBe(
      true,
    );
    expect(await reading()).toMatchObject({ output: { status: 'failed' } });
  });
});

function finishIn(page: { readonly records: readonly RecordedEvent[] }) {
  const finish = page.records.at(-1);
  return { type: finish?.type, data: finish?.data, by: finish?.context.by };
}

const everything = { kind: 'everything' } as const;

describe('a settlement', () => {
  it('carries every kind and because of an unavailable run, those of a step included', async () => {
    const { running, settling } = await withHandOn();
    await running();
    const detail = 'A tool server could not be used';

    expect(
      await settling({
        status: 'rejected',
        reason: 'unavailable',
        detail,
        kind: 'tool_server_failed',
        because: 'unreachable',
      }),
    ).toStrictEqual(
      Result.succeed({
        ...settled,
        status: 'rejected',
        rejection: { reason: 'unavailable', detail, kind: 'tool_server_failed', because: 'unreachable' },
      }),
    );
  });

  it('carries the issues of a rejected input and the record of a rejection', async () => {
    const { running, reading, settling } = await withHandOn();
    await running();
    const issues = [{ detail: 'Expected a customer', pointer: '/input/customer' }];

    await settling({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'No such customer',
      issues,
      record: { looked_up: 3 },
    });

    expect(await reading()).toMatchObject({
      output: {
        status: 'rejected',
        rejection: { reason: 'invalid_input', detail: 'No such customer', issues },
        record: { looked_up: 3 },
      },
    });
  });
});

describe('a settlement of a conflict or a cancellation', () => {
  it('records a conflict with its kind as given, and one without a kind without one', async () => {
    const { running, reading, settling } = await withHandOn();
    await running();
    const detail = 'The output takes more than a run records';
    await settling({ status: 'rejected', reason: 'conflict', detail, kind: 'oversized' });
    const withKind = await reading();
    await running();
    await settling({ status: 'rejected', reason: 'conflict', detail: 'Clashed' });

    expect([withKind, await reading()]).toMatchObject([
      { output: { rejection: { reason: 'conflict', detail, kind: 'oversized' } } },
      { output: { rejection: { reason: 'conflict', detail: 'Clashed' } } },
    ]);
    expect(await reading()).not.toHaveProperty('output.rejection.kind');
  });

  it('records a cancellation with its kind, a final result a call with its id answers again', async () => {
    const { running, relayer, settling } = await withHandOn();
    await running();
    const detail = 'The step that waited for it ran out of time';

    expect(await settling({ status: 'rejected', reason: 'cancelled', detail, kind: 'deadline' })).toStrictEqual(
      Result.succeed({ ...settled, status: 'rejected', rejection: { reason: 'cancelled', detail, kind: 'deadline' } }),
    );
    expect(await running()).toEqual({ status: 'rejected', reason: 'cancelled', detail, kind: 'deadline' });
    expect(relayer.runs()).toBe(1);
  });

  it('records a request nobody answered with its kind, a final result a call with its id answers again', async () => {
    const { running, relayer, settling } = await withHandOn();
    await running();
    const detail = 'Nobody answered before the request expired';

    expect(await settling({ status: 'rejected', reason: 'unanswered', detail, kind: 'expired' })).toStrictEqual(
      Result.succeed({ ...settled, status: 'rejected', rejection: { reason: 'unanswered', detail, kind: 'expired' } }),
    );
    expect(await running()).toEqual({ status: 'rejected', reason: 'unanswered', detail, kind: 'expired' });
    expect(relayer.runs()).toBe(1);
  });
});

describe('what a settlement records', () => {
  it('is an empty record for a success that names none, as the workflow host settles a run', async () => {
    const { running, reading, settling } = await withHandOn();
    await running();

    await settling({ status: 'succeeded', output: 'handed on' });

    expect(await reading()).toMatchObject({ output: { status: 'succeeded', output: 'handed on', record: {} } });
  });

  it('records a failure with its incident', async () => {
    const { running, ledger, run, settling } = await withHandOn();
    await running();

    await settling({ status: 'failed', incident: 'incident-1' });
    const page = await run(
      Effect.orDie(
        ledger.service.readRecorded({ org: 'acme', playbook: 'alpha' }, everything, { order: 'asc', limit: 20 }),
      ),
    );

    expect(finishIn(page)).toMatchObject({ type: 'run_failed', data: { incident: 'incident-1' } });
  });

  it('records the actor who settled it, the playbook itself when none is named', async () => {
    const { running, ledger, run, settling } = await withHandOn();
    const read = () =>
      run(
        Effect.orDie(
          ledger.service.readRecorded({ org: 'acme', playbook: 'alpha' }, everything, { order: 'asc', limit: 20 }),
        ),
      );
    await running();
    await settling({ status: 'rejected', reason: 'unavailable', detail: 'Gone' });
    const bySelf = finishIn(await read());
    await running();
    await settling({ ...success, by: 'acme-admin' });

    expect([bySelf, finishIn(await read())]).toMatchObject([{ by: 'playbook:alpha' }, { by: 'acme-admin' }]);
  });
});
