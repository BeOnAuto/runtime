import { describe, expect, it } from 'vitest';

import { activityStreamOf } from '../facts/activity-seen.ts';
import { projected } from '../testing/projected.ts';
import type { RecordedFact } from '../testing/recorded-facts.ts';
import { mostMarksKept, seenOf, seenRows } from './seen-rows.ts';

const ada = 'person:user_2ada';

const runAddress = (index: number) => `finance/runs/0199fe31-2a4b-7c5d-8e6f-${String(index).padStart(12, '0')}`;

const minute = (count: number) => Date.parse('2026-11-01T09:00:00.000Z') + count * 60_000;

const iso = (time: number) => new Date(time).toISOString();

interface Marked {
  readonly items?: readonly (readonly [string, number])[];
  readonly through?: readonly [number, string, string];
}

function seen({ items = [], through }: Marked, at: number, by = ada): RecordedFact {
  return {
    type: 'activity_seen',
    data: {
      items: items.map(([address, time]) => ({ address, at: iso(time) })),
      ...(through === undefined ? {} : { through: { at: iso(through[0]), playbook: through[1], key: through[2] } }),
    },
    context: { at: iso(at), by },
  };
}

async function seenAfter(...facts: readonly RecordedFact[]) {
  const { record, rows } = projected(seenRows, { org: 'acme' });
  await facts.reduce(
    (done: Promise<void>, fact) => done.then(() => record(`org/acme/${activityStreamOf(fact.context.by)}`, fact)),
    Promise.resolve(),
  );
  return rows();
}

describe('what each caller has seen of the activity', () => {
  it('keeps one row a caller, of the items they marked seen and where they marked everything seen through', async () => {
    const rows = await seenAfter(
      seen({ items: [[runAddress(1), minute(1)]] }, minute(10)),
      seen({ items: [[runAddress(2), minute(2)]] }, minute(11), 'local'),
    );

    expect(rows).toMatchObject({
      local: { marked: JSON.stringify([{ address: runAddress(2), at: minute(2) }]) },
      [ada]: {
        through_at: null,
        through_playbook: null,
        through_key: null,
        marked: JSON.stringify([{ address: runAddress(1), at: minute(1) }]),
        seen_at: null,
      },
    });
    expect(seenOf(rows[ada])).toEqual({
      through: undefined,
      marks: [{ address: runAddress(1), at: minute(1) }],
      seenAt: null,
    });
  });
});

describe('where a caller marked everything seen through', () => {
  it('moves forward only, when it was moved, and drops the marks at or before it', async () => {
    const rows = await seenAfter(
      seen(
        {
          items: [
            [runAddress(1), minute(1)],
            [runAddress(3), minute(3)],
            [runAddress(2), minute(2)],
          ],
        },
        minute(10),
      ),
      seen({ through: [minute(2), 'finance', 'runs/0199fe31-2a4b-7c5d-8e6f-000000000002'] }, minute(11)),
      seen(
        {
          through: [minute(1), 'finance', 'runs/x'],
          items: [
            [runAddress(4), minute(4)],
            [runAddress(3), minute(3)],
          ],
        },
        minute(12),
      ),
    );

    expect(seenOf(rows[ada])).toEqual({
      through: { at: minute(2), playbook: 'finance', key: 'runs/0199fe31-2a4b-7c5d-8e6f-000000000002' },
      marks: [
        { address: runAddress(4), at: minute(4) },
        { address: runAddress(3), at: minute(3) },
      ],
      seenAt: minute(11),
    });
  });
});

describe('the marks a caller keeps', () => {
  it(`keeps at most the ${mostMarksKept} marks newest in the activity, and none it cannot place`, async () => {
    const items = Array.from({ length: mostMarksKept + 5 }, (_, index): readonly [string, number] => [
      runAddress(index),
      minute(index),
    ]);
    const rows = await seenAfter(
      seen({ items: items.slice(0, 600) }, minute(10)),
      seen({ items: [...items.slice(600), ['not an address', minute(1)]] }, minute(11)),
      {
        ...seen({}, minute(12)),
        data: { items: [], through: { at: 'not a time', playbook: 'finance', key: 'runs/x' } },
      },
    );
    const { marks, through } = seenOf(rows[ada]);

    expect(marks).toHaveLength(mostMarksKept);
    expect(marks[0]).toEqual({ address: runAddress(mostMarksKept + 4), at: minute(mostMarksKept + 4) });
    expect(marks.at(-1)).toEqual({ address: runAddress(5), at: minute(5) });
    expect(through).toBeUndefined();
  });

  it('reads no position or marks from a row that keeps none, and folds nothing it cannot read', () => {
    expect(seenOf()).toEqual({ through: undefined, marks: [], seenAt: null });
    expect(seenOf({ marked: 'not JSON' })).toMatchObject({ marks: [] });
    expect(
      seenRows.rowAfter(undefined, {
        id: 'm',
        position: 1,
        type: 'activity_seen',
        data: {},
        context: { at: iso(0), by: ada },
      }),
    ).toBeUndefined();
    expect(
      seenRows.keyOf?.(
        { id: 'm', position: 1, type: 'activity_seen', data: {}, context: { at: iso(0), by: ada } },
        { kind: 'activity', id: 'x' },
      ),
    ).toBe(ada);
  });
});
