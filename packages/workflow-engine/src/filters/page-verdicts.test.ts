import { describe, expect, it } from 'vitest';

import type { JsonObject } from '../dsl/json.ts';
import { filterSandboxOf } from '../instances/host-sandboxes.ts';
import { sourcesUnderTest } from '../pool-testing/test-pools.ts';
import type { FilterSandbox } from './filter-verdicts.ts';
import { pageFiltersOn, pageVerdictsOf } from './page-verdicts.ts';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const filling = '${ (() => { const kept = []; for (;;) { kept.push("x".repeat(1048576) + kept.length); } })() }';

function closedIn(region: string): { readonly event: JsonObject; readonly now: number } {
  return { event: { type: 'com.acme.ledger.month-closed', data: { region } }, now };
}

function filterAt(reference: string, data: string) {
  return { reference, attributes: { type: 'com.acme.ledger.month-closed', data } };
}

function sessionsCounted(sandbox: FilterSandbox): { readonly sandbox: FilterSandbox; readonly opened: () => number } {
  const counts = { opened: 0 };
  return {
    sandbox: {
      ...sandbox,
      session: (opening) => {
        counts.opened += 1;
        return sandbox.session(opening);
      },
    },
    opened: () => counts.opened,
  };
}

const european = filterAt('/eu', '${ $data.region == "eu" }');

const american = filterAt('/us', '${ $data.region == "us" }');

describe.each(sourcesUnderTest)('a page of events judged as one by the filters on $name instances', ({ source }) => {
  it('answers each event’s verdicts in turn, in one session of the sandbox', async () => {
    const counting = sessionsCounted(filterSandboxOf(source, () => 0));

    const verdicts = await pageFiltersOn(counting.sandbox).verdictsOf(
      [european, american],
      [closedIn('eu'), closedIn('us'), closedIn('apac')],
    );

    expect(verdicts).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
    expect(counting.opened()).toBe(1);
  });

  it('ends at the first event a test the sandbox stopped judges, answering nothing of the events after it', async () => {
    const verdicts = await pageVerdictsOf(
      [filterAt('/filling', filling), european],
      [closedIn('eu'), closedIn('us')],
      filterSandboxOf(source, () => 0),
    );

    expect(verdicts).toMatchObject([[{ error: { instance: '/filling' }, stopped: true }, true]]);
  });

  it('answers nothing of a page that holds no event', async () => {
    expect(
      await pageVerdictsOf(
        [european],
        [],
        filterSandboxOf(source, () => 0),
      ),
    ).toEqual([]);
  });
});
