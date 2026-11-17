import type { Context } from '@on.auto/operations';
import { DatabaseFailed } from '@on.auto/workflow-host';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ChainFact, ChainOrigin } from './chain-origin.ts';
import { chainOriginsOf, mostOriginReads, type ChainReads } from './chain-origins.ts';
import { ledgerChainReads, type ChainStore, type StoredChainFact } from './ledger-chain-reads.ts';

const rule = { serviceCallers: new Set<string>() };

const at = '2026-11-09T09:00:00.000Z';

const onEvent: Partial<Context> = { trigger: { kind: 'event', reference: '/schedule/on' } };

const hourly: Partial<Context> = { trigger: { kind: 'cron', reference: '/schedule/cron' } };

interface Ledger {
  readonly runs: ReadonlyMap<string, ChainFact>;
  readonly records: ReadonlyMap<string, ChainFact>;
}

function ledgerOf(facts: readonly (readonly [string, ChainFact])[]): Ledger {
  const runs = new Map<string, ChainFact>();
  const records = new Map<string, ChainFact>();
  for (const [key, fact] of facts) {
    if (key.startsWith('run ')) {
      runs.set(key.slice(4), fact);
    } else {
      records.set(key, fact);
    }
  }
  return { runs, records };
}

function readsOver({ runs, records }: Ledger): ChainReads<never> {
  return {
    firstFactOf: (run) => Effect.succeed(runs.get(run)),
    recordOf: (id) => Effect.succeed(records.get(id)),
  };
}

function started(
  run: string,
  context: Partial<Context>,
  lineage: Partial<ChainFact> = {},
): readonly [string, ChainFact] {
  return [
    `run ${run}`,
    {
      stream: `playbook/acme/sales/runs/${run}`,
      context: { at, by: 'playbook:sales', runId: run, ...context },
      causationId: null,
      correlationId: run,
      ...lineage,
    },
  ];
}

function emitted(id: string, emitter: string, top = emitter): readonly [string, ChainFact] {
  return [
    id,
    {
      stream: `playbook/acme/sales/events/${id}`,
      context: { at, by: 'playbook:sales', runId: emitter },
      causationId: null,
      correlationId: top,
    },
  ];
}

function published(id: string, by: string): readonly [string, ChainFact] {
  return [
    id,
    { stream: `playbook/acme/sales/events/${id}`, context: { at, by }, causationId: null, correlationId: null },
  ];
}

const ledger = ledgerOf([
  started('ticked', hourly),
  started('asked', { by: 'person:user_one' }),
  started('keyed', { by: 'ops-key' }),
  started(
    'child',
    { by: 'ops-key', calledBy: { runId: 'keyed', reference: '/do/0', run: 1 } },
    { correlationId: 'keyed' },
  ),
  published('ping', 'person:user_one'),
  started('pinged', onEvent, { causationId: 'ping' }),
  emitted('pong', 'pinged'),
  started('ponged', onEvent, { causationId: 'pong' }),
  emitted('from-a-child', 'tick-child', 'ticked'),
  started('heard', onEvent, { causationId: 'from-a-child' }),
  started('noticed', { trigger: { kind: 'goal', reference: '/goals/g' } }),
  started('lost', onEvent, { causationId: 'missing' }),
  started('tried', { by: 'person:user_one', test: true }),
  started(
    'tried-child',
    { by: 'person:user_one', calledBy: { runId: 'tried', reference: '/do/0', run: 1 } },
    { correlationId: 'tried' },
  ),
  emitted('from-a-test', 'tried'),
  started('heard-a-test', onEvent, { causationId: 'from-a-test' }),
  emitted('from-a-test-reaction', 'heard-a-test'),
  started('heard-it-again', onEvent, { causationId: 'from-a-test-reaction' }),
]);

function originsOf(runs: readonly string[], reads: ChainReads<never> = readsOver(ledger)) {
  const origins = chainOriginsOf(reads, rule);
  return Effect.runSync(
    Effect.map(
      Effect.forEach(runs, (run) => origins.originOf({ run })),
      (found: readonly ChainOrigin[]) => ({ found, reads: origins.reads() }),
    ),
  );
}

describe('the origin of a run’s chain, walked over the facts of a ledger', () => {
  it('walks a schedule, a person, a key, a called child, a published event, an emitted event two levels deep and a notice', () => {
    expect(
      ['ticked', 'asked', 'keyed', 'child', 'pinged', 'ponged', 'heard', 'noticed'].map(
        (run) => originsOf([run]).found[0],
      ),
    ).toEqual(['schedule', 'person', 'machine', 'machine', 'person', 'person', 'schedule', 'playbook']);
  });

  it('reads two facts a level of reactions and one for a run that began its chain', () => {
    expect(['ticked', 'child', 'pinged', 'ponged'].map((run) => originsOf([run]).reads)).toEqual([1, 2, 2, 4]);
  });

  it('ends at a test for a run started as a test, each run it called and each run its events triggered, two levels deep', () => {
    expect(originsOf(['tried', 'tried-child', 'heard-a-test', 'heard-it-again']).found).toEqual([
      'test',
      'test',
      'test',
      'test',
    ]);
  });

  it('ends unknown when a run or a record it names is not in the ledger', () => {
    expect(originsOf(['gone', 'lost']).found).toEqual(['unknown', 'unknown']);
  });
});

function outsideOf(runs: readonly string[]) {
  const origins = chainOriginsOf(readsOver(ledger), rule);
  return Effect.runSync(Effect.forEach(runs, (run) => Effect.map(origins.chainOf({ run }), ({ outside }) => outside)));
}

describe('the event from outside every run that began a chain', () => {
  it('is the event a person published, for the run it started and for a run an event of that run started', () => {
    expect(outsideOf(['pinged', 'ponged', 'pinged'])).toEqual([
      { id: 'ping', at },
      { id: 'ping', at },
      { id: 'ping', at },
    ]);
  });

  it('is none for a chain begun by a schedule, a person, a key, a call, a notice or a run missing from the ledger', () => {
    expect(outsideOf(['ticked', 'asked', 'keyed', 'child', 'heard', 'noticed', 'gone', 'lost'])).toEqual(
      Array.from({ length: 8 }),
    );
  });
});

describe('the origins of the runs of one pass', () => {
  it('keeps an origin it found for every run of the walk, so the rest of a pass reads nothing for them', () => {
    const { found, reads } = originsOf(['ponged', 'pinged', 'child', 'keyed', 'ponged']);
    expect(found).toEqual(['person', 'person', 'machine', 'machine', 'person']);
    expect(reads).toBe(4 + 2);
  });

  it('decides from a fact the caller holds with no read for a schedule, and jumps to the top run for a called one', () => {
    const origins = chainOriginsOf(readsOver(ledger), rule);
    const [, ticked] = started('ticked', hourly);
    const [, child] = started('child', { by: 'ops-key' }, { correlationId: 'keyed' });
    const [, asked] = started('asked', { by: 'person:user_one' });
    const found = Effect.runSync(
      Effect.forEach(
        [
          { run: 'ticked', fact: ticked },
          { run: 'child', fact: child },
          { run: 'asked', fact: asked },
        ],
        origins.originOf,
      ),
    );
    expect({ found, reads: origins.reads() }).toEqual({ found: ['schedule', 'machine', 'person'], reads: 2 });
  });
});

describe('a walk that cannot end at who began the chain', () => {
  it('stops at the bound of reads with unknown, and keeps nothing so a shorter walk still finds the origin', () => {
    const depth = mostOriginReads;
    const chain = ledgerOf([
      published('e0', 'ops-key'),
      ...Array.from({ length: depth }, (_, level) => started(`r${level}`, onEvent, { causationId: `e${level}` })),
      ...Array.from({ length: depth }, (_, level) => emitted(`e${level + 1}`, `r${level}`)),
    ]);
    const reads = readsOver(chain);
    expect(originsOf([`r${depth / 2}`, 'r2'], reads).found).toEqual(['unknown', 'machine']);
    expect(originsOf([`r${depth / 2 - 1}`], reads)).toEqual({ found: ['machine'], reads: depth });
  });

  it('ends unknown on a chain that loops back on itself', () => {
    const looped = ledgerOf([
      started('a', onEvent, { causationId: 'from-b' }),
      emitted('from-b', 'b'),
      started('b', onEvent, { causationId: 'from-a' }),
      emitted('from-a', 'a'),
    ]);
    expect(originsOf(['a'], readsOver(looped)).found).toEqual(['unknown']);
  });
});

interface AskedStore {
  readonly store: ChainStore;
  readonly asked: readonly string[];
}

function storeOf(
  runs: ReadonlyMap<string, StoredChainFact>,
  records: ReadonlyMap<string, StoredChainFact>,
): AskedStore {
  const asked: string[] = [];
  const store: ChainStore = {
    readRecorded: (playbookKey, { run }, page) => {
      asked.push(`${playbookKey} run ${run} ${page.order} ${String(page.limit)} ${String(page.dataOf.length)}`);
      const first = runs.get(run);
      return Promise.resolve({ records: first === undefined ? [] : [first] });
    },
    readRecordedEvent: (playbookKey, id) => {
      asked.push(`${playbookKey} record ${id}`);
      return id === 'broken'
        ? Promise.reject(new Error('the store is not reachable'))
        : Promise.resolve(records.get(id));
    },
  };
  return { store, asked };
}

describe('the reads of a chain over a ledger’s recorded facts', () => {
  const first: StoredChainFact = {
    stream: 'playbook/acme/sales/runs/r1',
    metadata: { context: { at, by: 'local', runId: 'r1' } },
    causationId: 'c1',
    correlationId: 'r1',
  };

  it('reads the first fact of a run and a record by its id within the playbook, without their data', async () => {
    const { store, asked } = storeOf(new Map([['r1', first]]), new Map([['c1', first]]));
    const reads = ledgerChainReads(store, {
      org: 'acme',
      playbook: 'sales',
    });
    const read = await Effect.runPromise(
      Effect.all([reads.firstFactOf('r1'), reads.firstFactOf('r2'), reads.recordOf('c1'), reads.recordOf('c2')]),
    );
    const fact = { stream: first.stream, context: first.metadata.context, causationId: 'c1', correlationId: 'r1' };
    expect(read).toEqual([fact, undefined, fact, undefined]);
    expect(asked).toEqual([
      'playbook/acme/sales/ run r1 asc 1 0',
      'playbook/acme/sales/ run r2 asc 1 0',
      'playbook/acme/sales/ record c1',
      'playbook/acme/sales/ record c2',
    ]);
  });

  it('fails as the database failing when the store cannot be read, so the walk is tried again later', async () => {
    const reads = ledgerChainReads(storeOf(new Map(), new Map()).store, { org: 'acme', playbook: 'sales' });
    const failed = await Effect.runPromise(Effect.result(reads.recordOf('broken')));
    expect(failed).toEqual(Result.fail(new DatabaseFailed({ detail: 'Error: the store is not reachable' })));
  });
});
