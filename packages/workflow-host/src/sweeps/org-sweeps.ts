import type { AppendedStreams, LedgerStreams } from '@on.auto/ledger';
import { Effect } from 'effect';

import type { FollowedOrg, FollowedOrgs } from '../follower/followed-orgs.ts';
import { wokenOrgOf } from '../follower/org-records.ts';

interface SweptOrg {
  readonly org: string;
  readonly known: FollowedOrg | undefined;
}

export interface Sweep {
  readonly orgs: readonly SweptOrg[];
  readonly again: boolean;
}

export interface OrgSweeps {
  readonly started: () => Effect.Effect<void>;
  readonly next: () => Effect.Effect<Sweep>;
  readonly passAgain: (org: string) => void;
}

export const orgsInASweep = 128;

export const waitingInASweep = 64;

const messagesReadInASweep = 10_000;

interface Round {
  readonly after: string | null;
  readonly orgs: readonly SweptOrg[];
}

function sweptOf(known: FollowedOrg): SweptOrg {
  return { org: known.org, known };
}

function addedTo(chosen: ReadonlyMap<string, SweptOrg>, orgs: readonly SweptOrg[]): ReadonlyMap<string, SweptOrg> {
  const added = orgs.filter(({ org }) => !chosen.has(org));
  return new Map([...chosen, ...added.map((swept): [string, SweptOrg] => [swept.org, swept])]);
}

function roundGoneOn(orgs: FollowedOrgs, after: string | null, room: number): Effect.Effect<Round> {
  if (after === null || room <= 0) {
    return Effect.succeed({ after, orgs: [] });
  }
  return Effect.map(orgs.following(after, room), (followed) => {
    const last = followed.at(-1);
    return {
      after: last === undefined || followed.length < room ? null : last.org,
      orgs: followed.map((known) => sweptOf(known)),
    };
  });
}

function pendingOrgs() {
  const appendedSince = new Map<string, boolean>();
  return {
    appended: (orgs: readonly string[]) => {
      for (const org of orgs) {
        appendedSince.set(org, true);
      }
    },
    failed: (org: string) => {
      appendedSince.set(org, appendedSince.get(org) === true);
    },
    chosen: (room: number): readonly SweptOrg[] =>
      [...appendedSince.keys()].slice(0, room).map((org) => ({ org, known: undefined })),
    taken: (chosen: readonly SweptOrg[]) => {
      for (const { org } of chosen) {
        appendedSince.delete(org);
      }
    },
    left: () => [...appendedSince.values()].includes(true),
  };
}

type AppendedStore = Pick<LedgerStreams, 'readAppended'>;

export function orgSweepsOn(store: AppendedStore, orgs: FollowedOrgs): OrgSweeps {
  const state: { through: AppendedStreams['through'] | undefined; round: string | null } = {
    through: undefined,
    round: null,
  };
  const pending = pendingOrgs();
  const appendedSince = (most: number) =>
    Effect.tap(
      Effect.promise(() => store.readAppended(state.through, most)),
      (appended) =>
        Effect.sync(() => {
          state.through = appended.through;
          pending.appended(appended.streams.flatMap((stream) => wokenOrgOf(stream) ?? []));
        }),
    );
  return {
    started: () =>
      Effect.andThen(appendedSince(0), () =>
        Effect.sync(() => {
          state.round = '';
        }),
      ),
    passAgain: pending.failed,
    next: () =>
      Effect.gen(function* () {
        const appended = yield* appendedSince(messagesReadInASweep);
        const waiting = (yield* orgs.waitingForASweep(waitingInASweep)).map((known) => sweptOf(known));
        const chosen = pending.chosen(orgsInASweep - waiting.length);
        const changed = addedTo(new Map(), [...waiting, ...chosen]);
        const round = yield* roundGoneOn(orgs, state.round, orgsInASweep - changed.size);
        pending.taken(chosen);
        state.round = round.after;
        return {
          orgs: [...addedTo(changed, round.orgs).values()],
          again: appended.more || pending.left(),
        };
      }),
  };
}
