import { keptArmOf, keptIn, watchedStore } from '@on.auto/definitions/testing';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Struct } from 'effect';
import { describe, expect, it } from 'vitest';

import { failedRead, pagedReader, read, readingEachPageFor, runOf, type RunShown } from '../testing/succeeded-pages.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

function keptRunOf(day: number, note: string): RunShown {
  return { ...runOf(day, { note, page: 'p'.repeat(4096) }), kept: true };
}

function shown(run: RunShown): Omit<RunShown, 'kept'> {
  return Struct.omit(run, ['kept']);
}

async function contentKeeping(runs: readonly RunShown[]) {
  const watched = watchedStore();
  const { content } = memoryLedger(undefined, [], undefined, watched.store).service;
  await Effect.runPromise(Effect.forEach(runs, ({ output }) => keptIn(content, alpha, output)));
  return { content, watched };
}

const fifth = keptRunOf(5, 'Day 5');

const fourth = runOf(4, { note: 'Day 4' });

const third = keptRunOf(3, 'Day 3');

describe('a read of runs whose outputs their playbook keeps outside them', () => {
  it('reads each output it examines, and matches and answers it as an output kept inline', async () => {
    const { content, watched } = await contentKeeping([fifth, third]);

    expect(await read(pagedReader([{ runs: [fifth, fourth, third] }], content).reader, 10, { words: ['day'] })).toEqual(
      {
        output: { runs: [shown(fifth), fourth, shown(third)], more: false },
        record: { examined: 3, through: third.started_at },
      },
    );
    expect(watched.reads()).toBe(2);
  });

  it('is unavailable, an outage told from its bound, and reads no more, where the store of its content fails', async () => {
    const { content, watched } = await contentKeeping([fourth]);
    watched.fail();
    const many = Array.from({ length: 30 }, (_, day) => keptRunOf(day + 1, `Day ${day + 1}`));

    expect(await failedRead(pagedReader([{ runs: many }], content).reader)).toMatchObject({ _tag: 'unavailable' });
    expect(watched.reads()).toBeLessThanOrEqual(12);
  });

  it('is unavailable within its time, read on a real clock, where the store of its content never answers', async () => {
    const hanging = { ...memoryLedger().service.content, get: () => Effect.never };
    const started = Date.now();
    const notReadNow: unknown = expect.stringContaining('could not be read just now');

    expect(await failedRead(pagedReader([{ runs: [fifth, third] }], hanging).reader, 200)).toMatchObject({
      _tag: 'unavailable',
      detail: notReadNow,
    });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('a read of runs whose outputs are missing from their playbook’s content', () => {
  it('gives a missing output by its size where no words are asked, and passes it over where words are', async () => {
    const lost = keptRunOf(4, 'Day 4');
    const after = runOf(3, { note: 'Day 3' });
    const { bytes } = keptArmOf(lost.output);

    expect(await read(pagedReader([{ runs: [lost, after] }]).reader, 10)).toEqual({
      output: { runs: [{ ...Struct.omit(shown(lost), ['output']), bytes }], more: true },
      record: { examined: 1, through: lost.started_at },
    });
    expect(await read(pagedReader([{ runs: [lost, after] }]).reader, 10, { words: ['day'] })).toEqual({
      output: { runs: [after], more: false },
      record: { examined: 2, through: after.started_at },
    });
  });
});

describe('a read of runs whose ledger answers slowly', () => {
  it('answers every run, as before outputs were kept, however long its pages take beyond the time it gives kept outputs', async () => {
    const days = [4, 3, 2, 1].map((day) => runOf(day, { note: `Day ${day}` }));
    const pages = Array.from({ length: days.length }, (_, index) => ({ runs: days.slice(index, index + 1) }));
    const slowly = readingEachPageFor(pagedReader(pages).reader, 60);
    const started = Date.now();

    expect(await read(slowly, 10, {}, 100)).toEqual({
      output: { runs: days, more: false },
      record: { examined: 4, through: days[3]?.started_at },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(240);
  });
});

describe('a read of many runs whose outputs their playbook keeps outside them', () => {
  it('reads at most 100 outputs in a run of it, and then says there are more, over 1,000 runs', async () => {
    const runs = Array.from({ length: 1000 }, (_, index) => ({
      ...keptRunOf(1, `Run ${index}`),
      run_id: `0199a3c4-0000-7000-8000-${String(index).padStart(12, '0')}`,
    }));
    const { content, watched } = await contentKeeping(runs);
    const pages = Array.from({ length: 10 }, (_, page) => ({ runs: runs.slice(page * 100, page * 100 + 100) }));

    expect(await read(pagedReader(pages, content).reader, 10, { words: ['nothing-matches'] })).toEqual({
      output: { runs: [], more: true },
      record: { examined: 100, through: runs[99]?.started_at },
    });
    expect(watched.reads()).toBe(100);
  });
});
