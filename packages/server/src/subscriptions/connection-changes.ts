import {
  connectionChangesRelayed,
  connectionsStream,
  listensThroughAConnection,
  type ChangesRelayed,
  type ListeningParts,
} from '@on.auto/connections';
import { connectionTriggersOf } from '@on.auto/definitions/connection-triggers';
import { holdsASentRequest } from '@on.auto/interaction';
import { streamAppends, type LedgerStreams, type StreamSignal } from '@on.auto/ledger';
import type { Ledger, PlaybookAddress, ProjectionReader, StreamReader } from '@on.auto/operations';
import { activePlaybooksOf } from '@on.auto/playbooks';
import { oneWakeAtATime, type HostWakeUp, type WakeSignal } from '@on.auto/workflow-host';
import { Effect } from 'effect';

import { isARegistry } from '../sockets/served-sockets.ts';
import { noRequestSent } from './subscription-rounds.ts';

export interface ChangesListening {
  readonly streams: Pick<LedgerStreams, 'orgStreams'>;
  readonly appended?: StreamSignal;
}

type FollowingLedger = Pick<ProjectionReader, 'readProjectedRows'> &
  Pick<Ledger['Service'], 'readAppendedFacts'> &
  Pick<StreamReader, 'load'>;

interface FollowingParts extends ListeningParts {
  readonly ledger: FollowingLedger;
  readonly streams: ChangesListening['streams'];
  readonly appended: StreamSignal;
  readonly asked: (playbook: PlaybookAddress) => void;
}

interface FollowedBy {
  readonly ledger: FollowingLedger;
  readonly asked: (playbook: PlaybookAddress) => void;
  readonly arrangesAWay: boolean;
}

export type WakeUpWith = (signal: WakeSignal) => HostWakeUp;

type OrgStream = Awaited<ReturnType<LedgerStreams['orgStreams']>>[number];

interface Followed {
  readonly versions: Map<string, number>;
  readonly places: Map<string, string>;
}

const followedEveryMs = 60_000;

const changesWords = {
  unread:
    'The connections of the orgs could not be read for the subscription rounds their changes owe; the next round reads them again',
  unasked:
    'The playbooks of an org were not all asked for a subscription round after a change of its connections; the next round asks them again',
} as const;

function askedWhereItListens(parts: FollowingParts, playbook: PlaybookAddress): Effect.Effect<void> {
  return Effect.map(listensThroughAConnection(parts, playbook), (listens) => {
    if (listens) {
      parts.asked(playbook);
    }
  });
}

function relayedIn(parts: FollowingParts, { places }: Followed, org: string): Effect.Effect<ChangesRelayed, unknown> {
  return connectionChangesRelayed({
    ledger: parts.ledger,
    org,
    place: {
      kept: Effect.sync(() => places.get(org)),
      moved: (place) =>
        Effect.sync(() => {
          places.set(org, place);
        }),
    },
    playbooks: activePlaybooksOf(parts.ledger, { org }),
    asked: (playbook) => askedWhereItListens(parts, playbook),
  });
}

function followedTo(parts: FollowingParts, followed: Followed, { org, version }: OrgStream): Effect.Effect<void> {
  if (followed.versions.get(org) === version) {
    return Effect.void;
  }
  return relayedIn(parts, followed, org).pipe(
    Effect.flatMap(({ asked, unanswered }) =>
      unanswered === 0
        ? Effect.sync(() => {
            followed.versions.set(org, version);
          })
        : Effect.logWarning(changesWords.unasked).pipe(Effect.annotateLogs({ org, asked, unanswered })),
    ),
    Effect.catchCause((cause) => Effect.logWarning(changesWords.unread, cause).pipe(Effect.annotateLogs({ org }))),
  );
}

function forgottenBut({ versions, places }: Followed, listed: readonly OrgStream[]): void {
  const orgs = new Set(listed.map(({ org }) => org));
  for (const org of versions.keys()) {
    if (!orgs.has(org)) {
      versions.delete(org);
    }
  }
  for (const org of places.keys()) {
    if (!orgs.has(org)) {
      places.delete(org);
    }
  }
}

function roundOf(parts: FollowingParts, followed: Followed): Effect.Effect<void, unknown> {
  return Effect.flatMap(
    Effect.tryPromise(() => parts.streams.orgStreams(connectionsStream)),
    (listed) => {
      forgottenBut(followed, listed);
      return Effect.forEach(listed, (each) => followedTo(parts, followed, each), { discard: true });
    },
  );
}

export function connectionChangesWakeUpOf(parts: FollowingParts): WakeUpWith {
  return (signal) => {
    const followed: Followed = { versions: new Map(), places: new Map() };
    const due = { at: Number.NEGATIVE_INFINITY, signalled: false };
    const stopListening = parts.appended.listen((stream) => {
      if (isARegistry(stream)) {
        due.signalled = true;
        signal.raised();
      }
    });
    return {
      wakeUp: oneWakeAtATime(({ now }) =>
        Effect.gen(function* () {
          signal.renewed();
          if (due.signalled || now >= due.at) {
            due.signalled = false;
            due.at = now + followedEveryMs;
            yield* roundOf(parts, followed).pipe(
              Effect.catchCause((cause) => Effect.logWarning(changesWords.unread, cause)),
            );
          }
          return { nextDueAt: due.at };
        }),
      ),
      stop: () =>
        Effect.sync(() => {
          stopListening();
        }),
    };
  };
}

export function connectionChangesWakeUpsOf({
  ledger,
  asked,
  arrangesAWay,
}: FollowedBy): (listening: ChangesListening) => readonly WakeUpWith[] {
  const reads = {
    ledger,
    sentIn: arrangesAWay ? (playbook: PlaybookAddress) => holdsASentRequest(ledger, playbook) : noRequestSent,
    triggersIn: (playbook: PlaybookAddress) => connectionTriggersOf(ledger, playbook),
  };
  return ({ streams, appended }) => [
    connectionChangesWakeUpOf({ ...reads, asked, streams, appended: appended ?? streamAppends }),
  ];
}
