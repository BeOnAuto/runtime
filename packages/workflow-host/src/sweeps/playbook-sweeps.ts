import type { AppendedStreams, LedgerStreams } from '@on.auto/ledger';
import { Effect } from 'effect';

import type { FollowedPlaybook, FollowedPlaybooks } from '../follower/followed-playbooks.ts';
import { isOrgRegistry } from '../follower/playbook-discovery.ts';
import { followedPlaybookOf } from './wakes.ts';

interface SweptPlaybook {
  readonly playbookKey: string;
  readonly known: FollowedPlaybook | undefined;
}

export interface Sweep {
  readonly registries: readonly string[];
  readonly playbooks: readonly SweptPlaybook[];
  readonly again: boolean;
}

export interface PlaybookSweeps {
  readonly started: () => Effect.Effect<void>;
  readonly next: () => Effect.Effect<Sweep>;
  readonly passAgain: (playbookKey: string) => void;
  readonly registriesRead: (registries: readonly string[]) => void;
}

export const playbooksInASweep = 128;

export const waitingInASweep = 64;

const messagesReadInASweep = 10_000;

interface Round {
  readonly after: string | null;
  readonly playbooks: readonly SweptPlaybook[];
}

function sweptOf(known: FollowedPlaybook): SweptPlaybook {
  return { playbookKey: known.playbookKey, known };
}

function addedTo(
  chosen: ReadonlyMap<string, SweptPlaybook>,
  playbooks: readonly SweptPlaybook[],
): ReadonlyMap<string, SweptPlaybook> {
  const added = playbooks.filter(({ playbookKey }) => !chosen.has(playbookKey));
  return new Map([...chosen, ...added.map((playbook): [string, SweptPlaybook] => [playbook.playbookKey, playbook])]);
}

function roundGoneOn(playbooks: FollowedPlaybooks, after: string | null, room: number): Effect.Effect<Round> {
  if (after === null || room <= 0) {
    return Effect.succeed({ after, playbooks: [] });
  }
  return Effect.map(playbooks.following(after, room), (followed) => {
    const last = followed.at(-1);
    return {
      after: last === undefined || followed.length < room ? null : last.playbookKey,
      playbooks: followed.map((known) => sweptOf(known)),
    };
  });
}

function pendingPlaybooks() {
  const appendedSince = new Map<string, boolean>();
  return {
    appended: (playbookKeys: readonly string[]) => {
      for (const playbookKey of playbookKeys) {
        appendedSince.set(playbookKey, true);
      }
    },
    failed: (playbookKey: string) => {
      appendedSince.set(playbookKey, appendedSince.get(playbookKey) === true);
    },
    chosen: (room: number): readonly SweptPlaybook[] =>
      [...appendedSince.keys()].slice(0, room).map((playbookKey) => ({ playbookKey, known: undefined })),
    taken: (chosen: readonly SweptPlaybook[]) => {
      for (const { playbookKey } of chosen) {
        appendedSince.delete(playbookKey);
      }
    },
    left: () => [...appendedSince.values()].includes(true),
  };
}

type AppendedStore = Pick<LedgerStreams, 'readAppended'>;

export function playbookSweepsOn(store: AppendedStore, playbooks: FollowedPlaybooks): PlaybookSweeps {
  const state: { through: AppendedStreams['through'] | undefined; round: string | null } = {
    through: undefined,
    round: null,
  };
  const pending = pendingPlaybooks();
  const registries = new Set<string>();
  const appendedSince = (most: number) =>
    Effect.tap(
      Effect.promise(() => store.readAppended(state.through, most)),
      (appended) =>
        Effect.sync(() => {
          state.through = appended.through;
          pending.appended(appended.streams.flatMap((stream) => followedPlaybookOf(stream) ?? []));
          for (const registry of appended.streams.filter((stream) => isOrgRegistry(stream))) {
            registries.add(registry);
          }
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
    registriesRead: (read) => {
      for (const registry of read) {
        registries.delete(registry);
      }
    },
    next: () =>
      Effect.gen(function* () {
        const appended = yield* appendedSince(messagesReadInASweep);
        const waiting = (yield* playbooks.waitingForASweep(waitingInASweep)).map((known) => sweptOf(known));
        const chosen = pending.chosen(playbooksInASweep - waiting.length);
        const changed = addedTo(new Map(), [...waiting, ...chosen]);
        const round = yield* roundGoneOn(playbooks, state.round, playbooksInASweep - changed.size);
        pending.taken(chosen);
        state.round = round.after;
        return {
          registries: [...registries],
          playbooks: [...addedTo(changed, round.playbooks).values()],
          again: appended.more || pending.left(),
        };
      }),
  };
}
