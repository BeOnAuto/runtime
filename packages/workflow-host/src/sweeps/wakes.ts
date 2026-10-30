import { playbookKeyOfStream } from '@on.auto/ledger';
import { playbookOfStreamPrefix } from '@on.auto/operations';
import { Option } from 'effect';

import { isOrgRegistry } from '../follower/playbook-discovery.ts';

export interface Wakes {
  readonly woken: (stream: string) => void;
  readonly playbookAgain: (playbookKey: string) => void;
  readonly playbooksWoken: () => readonly string[];
  readonly registriesWoken: () => readonly string[];
  readonly anyWoken: () => boolean;
}

function isPlaybookKey(playbookKey: string): boolean {
  return Option.isSome(playbookOfStreamPrefix(playbookKey));
}

export function followedPlaybookOf(stream: string): string | undefined {
  const playbookKey = playbookKeyOfStream(stream);
  return playbookKey === undefined || !isPlaybookKey(playbookKey) || stream.startsWith(`${playbookKey}run-logs/`)
    ? undefined
    : playbookKey;
}

function takenFrom(keys: Set<string>): readonly string[] {
  const taken = [...keys];
  keys.clear();
  return taken;
}

export function wakesOf(): Wakes {
  const playbooks = new Set<string>();
  const registries = new Set<string>();
  return {
    woken: (stream) => {
      const playbookKey = followedPlaybookOf(stream);
      if (playbookKey !== undefined) {
        playbooks.add(playbookKey);
      }
      if (isOrgRegistry(stream)) {
        registries.add(stream);
      }
    },
    playbookAgain: (playbookKey) => {
      playbooks.add(playbookKey);
    },
    playbooksWoken: () => takenFrom(playbooks),
    registriesWoken: () => takenFrom(registries),
    anyWoken: () => playbooks.size > 0 || registries.size > 0,
  };
}
