import type { AppendedScope, CursorNotHeld, Ledger, PlaybookAddress } from '@on.auto/operations';
import { Effect, Exit } from 'effect';

import { connectionsStreamOfOrg } from '../registry/registry-decider.ts';

export const loopConnectionFacts: readonly string[] = [
  'connection_connected',
  'connection_removed',
  'connection_playbooks_set',
];

const factsInARead = 200;

type FactsReader = Pick<Ledger['Service'], 'readAppendedFacts'>;

interface RelayPlace {
  readonly kept: Effect.Effect<string | undefined, unknown>;
  readonly moved: (place: string) => Effect.Effect<void, unknown>;
}

interface ConnectionChangesParts {
  readonly ledger: FactsReader;
  readonly org: string;
  readonly place: RelayPlace;
  readonly playbooks: Effect.Effect<readonly PlaybookAddress[], unknown>;
  readonly asked: (playbook: PlaybookAddress) => Effect.Effect<void, unknown>;
}

export interface ChangesRelayed {
  readonly asked: number;
  readonly unanswered: number;
}

type Owing = { readonly owed: true } | { readonly owed: false; readonly through: string };

const owedNow: Owing = { owed: true };

function owingAfter(ledger: FactsReader, scope: AppendedScope, after: string): Effect.Effect<Owing, CursorNotHeld> {
  return Effect.flatMap(ledger.readAppendedFacts(scope, { after, most: factsInARead, dataOf: [] }), (read) => {
    if (read.facts.some(({ type }) => loopConnectionFacts.includes(type))) {
      return Effect.succeed(owedNow);
    }
    const passed: Owing = { owed: false, through: read.cursor };
    return read.more ? owingAfter(ledger, scope, read.cursor) : Effect.succeed(passed);
  });
}

function owingFrom(ledger: FactsReader, scope: AppendedScope, kept: string | undefined): Effect.Effect<Owing> {
  if (kept === undefined) {
    return Effect.succeed(owedNow);
  }
  return owingAfter(ledger, scope, kept).pipe(Effect.catchTag('cursor_not_held', () => Effect.succeed(owedNow)));
}

function eachAsked(parts: ConnectionChangesParts): Effect.Effect<ChangesRelayed, unknown> {
  return Effect.gen(function* () {
    const playbooks = yield* parts.playbooks;
    const failed = yield* Effect.forEach(
      playbooks,
      (playbook) => Effect.map(Effect.exit(parts.asked(playbook)), Exit.isFailure),
      { concurrency: 'unbounded' },
    );
    return { asked: playbooks.length, unanswered: failed.filter(Boolean).length };
  });
}

export function connectionChangesRelayed(parts: ConnectionChangesParts): Effect.Effect<ChangesRelayed, unknown> {
  const scope: AppendedScope = { kind: 'streams', streams: [connectionsStreamOfOrg(parts.org)] };
  return Effect.gen(function* () {
    const kept = yield* parts.place.kept;
    const owing = yield* owingFrom(parts.ledger, scope, kept);
    if (!owing.owed) {
      if (owing.through !== kept) {
        yield* parts.place.moved(owing.through);
      }
      return { asked: 0, unanswered: 0 };
    }
    const { cursor: newest } = yield* parts.ledger.readAppendedFacts(scope, { most: 1, dataOf: [] });
    const relayed = yield* eachAsked(parts);
    if (relayed.unanswered === 0) {
      yield* parts.place.moved(newest);
    }
    return relayed;
  });
}
