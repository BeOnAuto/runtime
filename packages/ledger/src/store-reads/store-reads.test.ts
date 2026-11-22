import { describe, expect, it } from 'vitest';

import {
  heaviestReads,
  mostReadsNamed,
  outsideAnyTally,
  readNameOfStream,
  readNamed,
  statementStarted,
  storeReadsAdded,
  storeReadsSummed,
  storeReadsTally,
  type StatementCounted,
  type StoreReads,
} from './store-reads.ts';

function steppedClock(...times: readonly number[]): () => number {
  const left = [...times];
  return () => left.shift() ?? Number.NaN;
}

function told(counted: StatementCounted): void {
  statementStarted()?.(counted);
}

function ranAStatement(rowsRead: number, rowsWritten = 0): Promise<void> {
  told({ rowsRead, rowsWritten });
  return Promise.resolve();
}

function foldOf(events: number): Promise<{ readonly messages: number }> {
  return readNamed(
    'fold:org.playbooks',
    async (): Promise<{ readonly messages: number }> => {
      await ranAStatement(events);
      return { messages: events };
    },
    ({ messages }) => messages,
  );
}

describe('the reads of the store a call made, by name', () => {
  it('counts each statement, the rows it read and wrote and its time under the read under way', async () => {
    const tally = storeReadsTally(steppedClock(10, 13, 20, 21, 30, 34));

    await tally.run(async () => {
      await readNamed('comments_3', async () => {
        await ranAStatement(4);
        await ranAStatement(2);
      });
      await readNamed('activity_2', () => ranAStatement(0, 3));
    });

    expect(tally.taken()).toEqual({
      comments_3: { n: 2, rows: 6, ms: 4 },
      activity_2: { n: 1, written: 3, ms: 4 },
    });
  });

  it('sums the repeats of a name, and the facts a fold folded', async () => {
    const tally = storeReadsTally();

    await tally.run(async () => {
      await foldOf(5);
      await foldOf(7);
    });

    expect(tally.taken()).toEqual({ 'fold:org.playbooks': { n: 2, rows: 12, events: 12 } });
  });

  it('reports no time without a clock, as on a platform whose clock stands still while code runs', async () => {
    const tally = storeReadsTally();

    await tally.run(() => readNamed('comments_3', () => ranAStatement(1)));

    expect(tally.taken()).toEqual({ comments_3: { n: 1, rows: 1 } });
  });
});

describe('the rows a statement of a call read', () => {
  it('reads the rows of a cursor as they stand when the tally is taken', async () => {
    const tally = storeReadsTally();
    const cursor = { rowsRead: 0, rowsWritten: 0 };

    await tally.run(() =>
      readNamed('comments_3', () => {
        told(cursor);
        return Promise.resolve();
      }),
    );
    cursor.rowsRead = 9;

    expect(tally.taken()).toEqual({ comments_3: { n: 1, rows: 9 } });
  });

  it('counts a cursor that names no rows as reading none', async () => {
    const tally = storeReadsTally();

    await tally.run(() => readNamed('comments_3', () => ranAStatement(Number.NaN, -1)));

    expect(tally.taken()).toEqual({ comments_3: { n: 1 } });
  });
});

describe('the names of the reads of a call', () => {
  it('names a statement outside any named read unnamed, and a read under a nested name by the inner one', async () => {
    const tally = storeReadsTally();

    await tally.run(async () => {
      await ranAStatement(1);
      await readNamed('append:playbook.runs', async () => {
        await ranAStatement(0, 1);
        await readNamed('run_outcomes_5', () => ranAStatement(1, 1));
      });
    });

    expect(tally.taken()).toEqual({
      unnamed: { n: 1, rows: 1 },
      'append:playbook.runs': { n: 1, written: 1 },
      run_outcomes_5: { n: 1, rows: 1, written: 1 },
    });
  });

  it('keeps a read that ran no statement, so a read on a store it cannot count is still named', async () => {
    const tally = storeReadsTally();

    await tally.run(() =>
      readNamed(
        'fold:playbook.runs',
        (): Promise<readonly number[]> => Promise.resolve([1, 2]),
        (events) => events.length,
      ),
    );

    expect(tally.taken()).toEqual({ 'fold:playbook.runs': { n: 0, events: 2 } });
  });

  it.each(['Comments', 'org/acme/playbooks', 'a'.repeat(32), 'fold:', 'x y', `fold:${'a1'.repeat(16)}`])(
    'names a read by a name of the wrong shape, %s, unnamed',
    async (name) => {
      const tally = storeReadsTally();

      await tally.run(() => readNamed(name, () => ranAStatement(1)));

      expect(tally.taken()).toEqual({ unnamed: { n: 1, rows: 1 } });
    },
  );
});

describe('the reads of a call, outside it and after it', () => {
  it('tells nothing and changes nothing outside a call', async () => {
    storeReadsAdded({ comments_3: { n: 1 } });

    expect(statementStarted()).toBeUndefined();
    await expect(readNamed('comments_3', () => Promise.resolve('read'))).resolves.toBe('read');
  });

  it('leaves out the work run outside any tally, as an object composing its runtime', async () => {
    const tally = storeReadsTally();

    await tally.run(() => outsideAnyTally(() => ranAStatement(1)));

    expect(tally.taken()).toEqual({});
  });

  it('counts nothing more once taken', async () => {
    const tally = storeReadsTally();
    const late: { statement?: () => Promise<void> } = {};

    await tally.run(() => {
      late.statement = () => ranAStatement(1);
      return Promise.resolve();
    });
    expect(tally.taken()).toEqual({});
    await tally.run(() => late.statement?.());

    expect(tally.taken()).toEqual({});
  });

  it('adds the reads another object made for the call, as a lender answers them', async () => {
    const tally = storeReadsTally();

    await tally.run(async () => {
      await readNamed('comments_3', () => ranAStatement(1));
      storeReadsAdded({
        comments_3: { n: 2, rows: 5, ms: 3 },
        activity_2: { n: 1, events: 4 },
        'Not A Name': { n: 1 },
      });
    });

    expect(tally.taken()).toEqual({
      unnamed: { n: 1 },
      comments_3: { n: 3, rows: 6, ms: 3 },
      activity_2: { n: 1, events: 4 },
    });
  });
});

describe('the reads of several objects summed', () => {
  it('adds each name of the one to the same name of the other', () => {
    const one: StoreReads = { comments_3: { n: 1, rows: 2 }, unnamed: { n: 1 } };
    const other: StoreReads = { comments_3: { n: 2, rows: 3, written: 1, events: 1, ms: 2 }, activity_2: { n: 1 } };

    expect(storeReadsSummed(one, other)).toEqual({
      comments_3: { n: 3, rows: 5, written: 1, events: 1, ms: 2 },
      unnamed: { n: 1 },
      activity_2: { n: 1 },
    });
  });
});

describe('the heaviest reads of a call, the rest as one', () => {
  const reads: StoreReads = {
    a_1: { n: 1, rows: 10 },
    b_1: { n: 2, rows: 30, ms: 1 },
    c_1: { n: 3, rows: 20, events: 4 },
    d_1: { n: 4, rows: 5, written: 2, ms: 2 },
    e_1: { n: 1 },
  };

  it('keeps every read where there are no more than the most', () => {
    expect(heaviestReads(reads, 5)).toEqual(reads);
  });

  it('keeps the most by the rows they read and sums the rest under other', () => {
    expect(heaviestReads(reads, 2)).toEqual({
      b_1: { n: 2, rows: 30, ms: 1 },
      c_1: { n: 3, rows: 20, events: 4 },
      other: { n: 6, rows: 15, written: 2, ms: 2 },
    });
  });

  it('ships keeping eight', () => {
    expect(mostReadsNamed).toBe(8);
  });
});

describe('the name of a read of a stream', () => {
  it.each([
    ['org/acme/playbooks', 'fold:org.playbooks'],
    ['org/acme/connections/c1', 'fold:org.connections'],
    ['playbook/acme/sales/runs/r1', 'fold:playbook.runs'],
    ['definition/acme/d1/versions/v1', 'fold:definition.versions'],
    ['playbook/acme/sales/Runs/r1', 'fold:playbook.other'],
    ['playbook/acme', 'fold:playbook.other'],
    ['elsewhere/acme/runs', 'fold:other'],
  ])('names %s by its kind alone, %s', (stream, name) => {
    expect(readNameOfStream('fold', stream)).toBe(name);
  });
});
