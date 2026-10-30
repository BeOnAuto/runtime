import type { DslError, FilterVerdict } from '@on.auto/workflow-engine';
import { describe, expect, it } from 'vitest';

import { filterStops, stopsInARowBeforeTheVersion, type FilterPlace, type FilterStops } from './filter-matching.ts';

const error: DslError = {
  type: 'runtime',
  status: 500,
  instance: '/schedule/on/one',
};

const stoppedByItsDeadline: FilterVerdict = { error, stopped: true };

const stoppedByItsWork: FilterVerdict = { error, stopped: false };

const trigger: FilterPlace = {
  kind: 'trigger',
  playbookKey: 'playbook/acme/alpha/',
  workflow: 'close',
  version: 1,
  reference: '/schedule/on',
};

const listener: FilterPlace = { ...trigger, kind: 'listener', reference: '/do/0/wait' };

function judgedEach(stops: FilterStops, place: FilterPlace, verdicts: readonly FilterVerdict[]): readonly string[] {
  return verdicts.map((verdict) => stops.judged(place, 0, verdict).kind);
}

describe('the stops of a filter', () => {
  it(`stop it for its version after ${stopsInARowBeforeTheVersion} stops in a row by its deadline or its memory, saying with which error`, () => {
    const stops = filterStops();

    const judged = judgedEach(stops, trigger, [stoppedByItsDeadline, stoppedByItsDeadline]);
    const third = stops.judged(trigger, 0, stoppedByItsDeadline);

    expect([...judged, third]).toEqual(['struck', 'struck', { kind: 'stopped', error }]);
    expect([stops.isStopped(trigger, 0), stops.isStopped(trigger, 1)]).toEqual([true, false]);
  });

  it('count again from nothing after any answer, and never count a stop by its work or a raise', () => {
    const stops = filterStops();

    const judged = judgedEach(stops, trigger, [
      stoppedByItsDeadline,
      stoppedByItsDeadline,
      true,
      stoppedByItsDeadline,
      stoppedByItsWork,
      stoppedByItsDeadline,
      stoppedByItsDeadline,
      false,
    ]);

    expect(judged).toEqual(['struck', 'struck', 'answered', 'struck', 'answered', 'struck', 'struck', 'answered']);
    expect(stops.isStopped(trigger, 0)).toBe(false);
  });

  it('say a failure first once for each place, and again for a new version', () => {
    const stops = filterStops();

    const firsts = [stops.failedFirst(trigger), stops.failedFirst(trigger), stops.failedFirst(listener)];
    stops.activated(trigger.playbookKey, trigger.workflow, 2);
    const again = stops.failedFirst({ ...trigger, version: 2 });

    expect([...firsts, again]).toEqual([true, false, true, true]);
  });
});

describe('the stops kept for a workflow', () => {
  it("forget a trigger's stops of other versions when a version is activated, and every trigger's when it is retired, keeping its listeners'", () => {
    const stops = filterStops();
    const second = { ...trigger, version: 2 };
    for (const place of [trigger, second, listener]) {
      judgedEach(stops, place, [stoppedByItsDeadline, stoppedByItsDeadline, stoppedByItsDeadline]);
    }

    stops.activated(trigger.playbookKey, trigger.workflow, 2);
    const afterTheVersion = [trigger, second, listener].map((place) => stops.isStopped(place, 0));
    stops.retired(trigger.playbookKey, trigger.workflow);
    const afterTheRetirement = [second, listener].map((place) => stops.holds(place));

    expect([afterTheVersion, afterTheRetirement]).toEqual([
      [false, true, true],
      [false, true],
    ]);
  });

  it("forget a listener's stops when the last listener of its place ended, and hold none for a workflow that has no stops", () => {
    const stops = filterStops();
    judgedEach(stops, listener, [stoppedByItsDeadline]);
    const other = { ...listener, reference: '/do/1/wait' };
    judgedEach(stops, other, [stoppedByItsDeadline]);

    stops.listenerEnded(listener);
    const held = [stops.holds(listener), stops.holds(other)];
    stops.listenerEnded(other);
    stops.retired('playbook/acme/beta/', 'other');

    expect([held, stops.holds(other)]).toEqual([[false, true], false]);
  });
});
