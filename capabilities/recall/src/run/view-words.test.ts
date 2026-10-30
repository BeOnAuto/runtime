import type { StallCause } from '@on.auto/workflow-host';
import { describe, expect, it } from 'vitest';

import { liveView } from '../testing/recall-runs.ts';
import { lagInWords, lagOf, rebuildingDetail, stalledDetail } from './view-words.ts';

const stalledEvent = {
  id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1b',
  type: 'run_succeeded',
  time: '2026-10-06T10:00:01.000Z',
};

const stallWords: readonly (readonly [StallCause, string])[] = [
  ['raised', 'its fold raised an error'],
  ['work', 'its fold did more than the 500 checkpoints of work one fold may do'],
  ['time', 'its fold ran past the 10000 ms one fold may take, every time it was tried'],
  ['memory', 'its fold used more memory than a fold may'],
  ['crash', 'its fold broke the worker that ran it, every time it was tried'],
  ['size', 'the view it folded took more than the 524288 bytes a view may'],
  ['schema', "the view it folded did not match the view's schema"],
  ['unfit', 'its fold answered a view that is not JSON, or one nested deeper than 512 levels'],
  ['refused', 'its module does not load on this server'],
];

describe('how far a view lags the playbook', () => {
  it('is the time between the playbook’s newest record and the record at the checkpoint, unknown until both are known', () => {
    expect([
      lagOf('2026-10-06T10:02:05.000Z', '2026-10-06T10:00:05.000Z'),
      lagOf('2026-10-06T10:00:05.000Z', '2026-10-06T10:00:06.000Z'),
      lagOf('2026-10-06T10:00:05.000Z', null),
    ]).toEqual([120_000, 0, undefined]);
  });

  it('is said in the largest whole unit, and as less than a second below one', () => {
    expect([
      lagInWords(lagOf('2026-10-06T10:00:05.000Z', null)),
      lagInWords(999),
      lagInWords(1000),
      lagInWords(61_000),
      lagInWords(7_200_000),
      lagInWords(3 * 86_400_000 + 5000),
    ]).toEqual(['less than a second', 'less than a second', '1 second', '1 minute', '2 hours', '3 days']);
  });
});

describe('the detail of a run while its view is built', () => {
  it('says the view has not begun, waits behind others, or how far it has come, and to try again', () => {
    const building = liveView({}, { phase: 'rebuilding', folded: 1200, checkpointAt: '2026-10-06T10:00:05.000Z' });

    expect(rebuildingDetail('reviews', 2, liveView({}), '2026-10-06T10:02:05.000Z')).toBe(
      "The recall function “reviews” has not begun to build its view of version 2 from the playbook's history yet; try again in a little while",
    );
    expect(rebuildingDetail('reviews', 1, liveView({}, { phase: 'waiting' }), '2026-10-06T10:02:05.000Z')).toBe(
      'The recall function “reviews” waits to build its view of version 1, behind other recall functions of this playbook being built; try again in a little while',
    );
    expect(rebuildingDetail('reviews', 1, building, '2026-10-06T10:02:05.000Z')).toBe(
      "The recall function “reviews” is building its view of version 1 from the playbook's history: it has folded 1200 events so far, and is 2 minutes behind the playbook's newest record; try again in a little while",
    );
  });
});

describe('the detail of a run whose view stalled', () => {
  it.each(stallWords)(
    'says in fixed words that %s, with the type and time of the event, never its message',
    (kind, words) => {
      const detail = stalledDetail('reviews', { event: stalledEvent, kind, message: 'cannot take bad', line: null });

      expect(detail).toBe(
        `The view of the recall function “reviews” stopped at the run_succeeded event of 2026-10-06T10:00:01.000Z: ${words}. Save a corrected version to build the view again from the playbook's history`,
      );
    },
  );

  it('names the line of the fold where it stopped, when there is one', () => {
    const detail = stalledDetail('reviews', {
      event: stalledEvent,
      kind: 'raised',
      message: 'cannot take bad',
      line: 31,
    });

    expect(detail).toContain('its fold raised an error on line 31. Save a corrected version');
    expect(detail).not.toContain(stalledEvent.id);
    expect(detail).not.toContain('cannot take bad');
  });
});
