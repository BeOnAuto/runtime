import { Effect } from 'effect';

import type {
  ListedArrival,
  Mark,
  MadeSubscription,
  Positions,
  RecordedFailure,
  RecordedSubscription,
  SubscriptionKey,
  SubscriptionRecords,
  TakeListed,
  TakenIn,
} from '../subscriptions/subscription-ports.ts';

type Fact =
  | { readonly type: 'made'; readonly key: SubscriptionKey; readonly made: MadeSubscription }
  | { readonly type: 'failed'; readonly key: SubscriptionKey; readonly failed: RecordedFailure }
  | { readonly type: 'removed'; readonly key: SubscriptionKey }
  | { readonly type: 'read'; readonly key: SubscriptionKey; readonly since: string };

export interface FakeRecords {
  readonly records: SubscriptionRecords;
  readonly facts: () => readonly Fact[];
  readonly rows: () => readonly RecordedSubscription[];
  readonly rebuilt: () => void;
  readonly stopsBeforeTheNextMade: () => void;
}

function keyText({ connection, topic }: SubscriptionKey): string {
  return JSON.stringify([connection, topic]);
}

interface Marked {
  readonly since: string;
  readonly pageToken: string | null;
}

function withMark(row: RecordedSubscription, mark: Marked | undefined): RecordedSubscription {
  if (mark === undefined || row.made?.type !== 'polling') {
    return row;
  }
  const { since, pageToken } = mark;
  return { ...row, made: { ...row.made, since }, ...(pageToken === null ? {} : { pageToken }) };
}

function foldedOnto(rows: Map<string, RecordedSubscription>, fact: Fact): void {
  const { connection, topic } = fact.key;
  const key = keyText(fact.key);
  const row = rows.get(key) ?? { connection, topic };
  if (fact.type === 'removed') {
    rows.delete(key);
  } else if (fact.type === 'made') {
    rows.set(key, { connection, topic, made: fact.made });
  } else if (fact.type === 'failed') {
    rows.set(key, { ...row, failed: fact.failed });
  } else {
    rows.set(key, withMark(row, { since: fact.since, pageToken: null }));
  }
}

function folded(facts: readonly Fact[]): ReadonlyMap<string, RecordedSubscription> {
  const rows = new Map<string, RecordedSubscription>();
  for (const fact of facts) {
    foldedOnto(rows, fact);
  }
  return rows;
}

function positionedAs(row: RecordedSubscription, positions: Positions | undefined): RecordedSubscription {
  return positions === undefined ? row : { ...row, positions };
}

function isMarkedAt(row: RecordedSubscription | undefined, since: string): boolean {
  return row?.made?.type === 'polling' && row.made.since === since;
}

class KeptRecords {
  readonly #facts: Fact[] = [];
  readonly #positions = new Map<string, Positions>();
  readonly #marks = new Map<string, Marked>();
  readonly #stops: boolean[] = [];

  facts(): readonly Fact[] {
    return this.#facts;
  }

  rows(): readonly RecordedSubscription[] {
    return [...folded(this.#facts).values()].map((row) =>
      positionedAs(withMark(row, this.#marks.get(keyText(row))), this.#positions.get(keyText(row))),
    );
  }

  recorded(fact: Fact): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#facts.push(fact);
      if (fact.type !== 'failed') {
        this.#marks.delete(keyText(fact.key));
      }
      if (fact.type === 'removed') {
        this.#positions.delete(keyText(fact.key));
      }
    });
  }

  made(key: SubscriptionKey, made: MadeSubscription): Effect.Effect<void> {
    return this.#stops.shift() === true
      ? Effect.die('the runtime stopped')
      : this.recorded({ type: 'made', key, made });
  }

  moved(key: SubscriptionKey, positions: Positions): Effect.Effect<void> {
    return Effect.sync(() => {
      this.#positions.set(keyText(key), positions);
    });
  }

  marked(key: SubscriptionKey, { since, pageToken, positions }: Mark, from: string): Effect.Effect<void> {
    return Effect.sync(() => {
      if (isMarkedAt(this.#rowAt(key), from)) {
        this.#positions.set(keyText(key), positions);
        this.#marks.set(keyText(key), { since, pageToken });
      }
    });
  }

  readThrough(key: SubscriptionKey, since: string): Effect.Effect<void> {
    return isMarkedAt(this.#rowAt(key), since) ? this.recorded({ type: 'read', key, since }) : Effect.void;
  }

  rebuilt(): void {
    this.#positions.clear();
    this.#marks.clear();
  }

  stopsBeforeTheNextMade(): void {
    this.#stops.push(true);
  }

  #rowAt(key: SubscriptionKey): RecordedSubscription | undefined {
    return this.rows().find((row) => keyText(row) === keyText(key));
  }
}

export function inMemoryRecords(mostPartLength: number): FakeRecords {
  const kept = new KeptRecords();
  return {
    records: {
      read: () => Effect.sync(() => kept.rows()),
      made: (_playbook, key, made) => kept.made(key, made),
      failed: (_playbook, key, failed) => kept.recorded({ type: 'failed', key, failed }),
      removed: (_playbook, key) => kept.recorded({ type: 'removed', key }),
      moved: (_playbook, key, positions) => kept.moved(key, positions),
      marked: (_playbook, key, mark, from) => kept.marked(key, mark, from),
      readThrough: (_playbook, key, since) => kept.readThrough(key, since),
      holds: (part) => part.length <= mostPartLength,
    },
    facts: () => kept.facts(),
    rows: () => kept.rows(),
    rebuilt: () => {
      kept.rebuilt();
    },
    stopsBeforeTheNextMade: () => {
      kept.stopsBeforeTheNextMade();
    },
  };
}

export interface FakeIntake {
  readonly takeIn: TakeListed;
  readonly arrivals: () => readonly ListedArrival[];
  readonly events: () => readonly string[];
  readonly answers: (...answers: readonly TakenIn[]) => void;
}

export function anIntake(): FakeIntake {
  const arrivals: ListedArrival[] = [];
  const recorded = new Set<string>();
  const answers: TakenIn[] = [];
  return {
    takeIn: (arrival) =>
      Effect.sync(() => {
        arrivals.push(arrival);
        const answer = answers.shift() ?? 'taken';
        if (answer === 'taken') {
          recorded.add(arrival.event.id);
        }
        return answer;
      }),
    arrivals: () => arrivals,
    events: () => [...recorded],
    answers: (...more) => {
      answers.push(...more);
    },
  };
}
