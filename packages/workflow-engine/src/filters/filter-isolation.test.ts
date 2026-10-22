import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import { filterSandboxOf } from '../instances/host-sandboxes.ts';
import { filterVerdictsOf, type FilterSandbox } from './filter-verdicts.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const closed: JsonObject = { type: 'com.acme.ledger.month-closed', data: { region: 'eu' } };

const writingTheIteratorPrototype =
  '${ (() => { const holder = Object.getPrototypeOf([][Symbol.iterator]()); const seen = holder.seen === true; try { holder.seen = true; } catch {} return seen; })() }';

const filling = '${ (() => { const kept = []; for (;;) { kept.push("x".repeat(1048576) + kept.length); } })() }';

const working = '${ (() => { let turns = 0; for (;;) { turns += 1; } })() }';

function filterAt(reference: string, data = writingTheIteratorPrototype) {
  return { reference, attributes: { type: 'com.acme.ledger.month-closed', data } };
}

describe('the filters of a sandbox that breaks', () => {
  it('pass on a failure that is not a raise of the filter, unchanged', async () => {
    const failure = new TypeError('the sandbox broke');
    const sandbox = filterSandboxOf(shippedFilesOnDisk, () => 0);
    const breaking: FilterSandbox = {
      ...sandbox,
      session: async (opening) => ({
        ...(await sandbox.session(opening)),
        define: () => () => Promise.reject(failure),
      }),
    };

    await expect(filterVerdictsOf([filterAt('/eu', '${ $data.region == "eu" }')], closed, breaking, now)).rejects.toBe(
      failure,
    );
  });
});

describe('the filters of one batch', () => {
  it('share no state through an intrinsic no global names, so each answers as it would alone', async () => {
    const [first, second] = [filterAt('/first'), filterAt('/second')];
    const sandbox = filterSandboxOf(shippedFilesOnDisk, () => 0);

    const together = await filterVerdictsOf([first, second], closed, sandbox, now);
    const alone = [
      ...(await filterVerdictsOf([first], closed, sandbox, now)),
      ...(await filterVerdictsOf([second], closed, sandbox, now)),
    ];

    expect(together).toEqual([false, false]);
    expect(together).toEqual(alone);
  });

  it('take a fresh context after one its sandbox refused, so one filter that fills its memory fails no other', async () => {
    const sandbox = filterSandboxOf(shippedFilesOnDisk, () => 0);

    const verdicts = await filterVerdictsOf(
      [
        filterAt('/filling', filling),
        filterAt('/eu', '${ $data.region == "eu" }'),
        filterAt('/us', '${ $data.region == "us" }'),
      ],
      closed,
      sandbox,
      now,
    );

    expect(verdicts).toMatchObject([{ error: { status: 500, instance: '/filling' } }, true, false]);
    expect(JSON.stringify(verdicts[0])).toContain('one filter may use the memory of its sandbox and no more');
  });

  it('say a filter was stopped when its memory or its deadline ended it, which no event causes, and not when its work did', async () => {
    const sandbox = filterSandboxOf(shippedFilesOnDisk, () => 0);

    const verdicts = await filterVerdictsOf(
      [filterAt('/working', working), filterAt('/filling', filling), filterAt('/eu', '${ $data.region == "eu" }')],
      closed,
      sandbox,
      now,
    );

    expect(verdicts).toMatchObject([
      { error: { instance: '/working' }, stopped: false },
      { error: { instance: '/filling' }, stopped: true },
      true,
    ]);
  });
});
