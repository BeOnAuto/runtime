import type { LoggedEvent, LogPorts } from '@on.auto/ledger';
import { describe, expect, it } from 'vitest';

import { pickOf, seeded } from '../meter-testing/random-ledgers.ts';
import { countedAfter, countedFromTheStart } from './run-starts.ts';

const streams = [
  'playbook/acme/alpha/runs/one',
  'playbook/acme/alpha/runs/two',
  'playbook/acme/beta/runs/one',
  'playbook/globex/gamma/runs/three',
  'playbook/acme/alpha/definitions/totals',
  'org/acme/connections',
  'meter',
];

function positionOf(point: readonly string[] | undefined): number {
  return Number(point?.at(0) ?? 0);
}

function memoryLog(events: readonly LoggedEvent[]): LogPorts {
  return {
    head: () => Promise.resolve(events.at(-1)?.point),
    after: (point, most) => {
      const from = positionOf(point);
      const page = events.slice(from, from + most);
      return Promise.resolve({ events: page, through: page.at(-1)?.point ?? point, more: from + most < events.length });
    },
    at: (point) => Promise.resolve(events.at(positionOf(point) - 1)),
  };
}

function randomLog(seed: number): readonly LoggedEvent[] {
  const pick = pickOf(seeded(seed));
  const versions = new Map<string, number>();
  return Array.from({ length: pick(0, 3, 40, 700, 1300) }, (_, index): LoggedEvent => {
    const stream = pick(streams[0] ?? '', ...streams);
    const version = (versions.get(stream) ?? 0) + 1;
    versions.set(stream, version);
    const type = pick('run_started', 'run_succeeded', 'definition_created');
    return { id: `${stream}@${String(version)}`, stream, version, type, point: [String(index + 1)] };
  });
}

function firstStartsIn(events: readonly LoggedEvent[]): (stream: string) => Promise<number | undefined> {
  return (stream) =>
    Promise.resolve(events.find((event) => event.stream === stream && event.type === 'run_started')?.version);
}

function runsStartedIn(events: readonly LoggedEvent[]): number {
  const runStarts = events.filter(({ stream, type }) => type === 'run_started' && stream.includes('/runs/'));
  return new Set(runStarts.map(({ stream }) => stream)).size;
}

interface Counts {
  readonly seed: number;
  readonly expected: number;
  readonly fresh: number;
  readonly incremental: number;
}

function mismatchesIn(counts: readonly Counts[]): readonly Counts[] {
  return counts.filter(({ expected, fresh, incremental }) => fresh !== expected || incremental !== expected);
}

function kindsOfCountIn(counts: readonly Counts[]): number {
  return new Set(counts.map(({ expected }) => expected)).size;
}

async function countsOf(seed: number): Promise<Counts> {
  const events = randomLog(seed);
  const cut = Math.floor(seeded(seed + 1)() * (events.length + 1));
  const before = await countedFromTheStart(memoryLog(events.slice(0, cut)));
  const fresh = await countedFromTheStart(memoryLog(events));
  const incremental = await countedAfter(memoryLog(events), firstStartsIn(events), before);
  return { seed, expected: runsStartedIn(events), fresh: fresh.actions, incremental: incremental.actions };
}

describe('the count of the run starts of a log', () => {
  it('is the same counted from the first event or from any checkpoint, and counts each run once, over 2,000 random logs', async () => {
    const seeds = Array.from({ length: 2000 }, (_, index) => index + 1);
    const counts = await Promise.all(seeds.map((seed) => countsOf(seed)));

    expect(mismatchesIn(counts)).toEqual([]);
    expect(kindsOfCountIn(counts)).toBe(5);
  });

  it('knows which runs it saw start, from the first event or from a checkpoint', async () => {
    const events = randomLog(11);
    const fresh = await countedFromTheStart(memoryLog(events));
    const incremental = await countedAfter(memoryLog(events), firstStartsIn(events), {
      actions: 0,
      through: undefined,
      last: undefined,
    });

    const started = streams.map((stream) => runsStartedIn(events.filter((event) => event.stream === stream)) > 0);
    expect(streams.map((stream) => fresh.hasStarted(stream))).toEqual(started);
    expect(streams.map((stream) => incremental.hasStarted(stream))).toEqual(started);
    expect(new Set(started)).toEqual(new Set([true, false]));
  });
});
