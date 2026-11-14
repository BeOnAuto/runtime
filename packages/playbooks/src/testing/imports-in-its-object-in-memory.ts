import { Conflict, Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import type { CheckedGoals, PlaybookGoals } from '../goals/playbook-goals.ts';
import type {
  ImportAsked,
  ImportedInItsObject,
  ImportedPackage,
  ImportMark,
  ImportStanding,
  PlaybookImportsInItsObject,
} from '../imports/playbook-imports.ts';
import { refusedDefinition } from './imports-in-memory.ts';

export interface ImportsInItsObjectInMemory extends PlaybookImportsInItsObject {
  readonly copied: (address: PlaybookAddress) => readonly string[];
  readonly reservedFor: (address: PlaybookAddress) => string | undefined;
  readonly cutAfter: (count: number) => void;
}

function keyOf({ org, playbook }: PlaybookAddress): string {
  return `${org}/${playbook}`;
}

function digestOf({ definitions }: ImportedPackage): string {
  return JSON.stringify(definitions);
}

function issuesOf({ definitions }: ImportedPackage) {
  return definitions.flatMap(({ name }, index) =>
    name === refusedDefinition
      ? [{ pointer: `/package/definitions/${String(index)}`, detail: 'This definition is refused' }]
      : [],
  );
}

function refusalOf(started: ImportMark | undefined, mark: ImportMark): Conflict | undefined {
  if (started === undefined || (started.import_id === mark.import_id && started.digest === mark.digest)) {
    return undefined;
  }
  return started.import_id === mark.import_id
    ? new Conflict({ detail: 'The import was begun with another package' })
    : new Conflict({ detail: 'Another import made this playbook', kind: 'taken' });
}

interface Kept {
  readonly goals: PlaybookGoals;
  readonly reservationOf: (address: PlaybookAddress) => ImportMark | undefined;
  readonly reserve: (address: PlaybookAddress, mark: ImportMark) => void;
  readonly release: (address: PlaybookAddress) => void;
  readonly standingOf: (address: PlaybookAddress) => ImportStanding;
  readonly keep: (address: PlaybookAddress, standing: ImportStanding) => void;
  readonly copyOf: (address: PlaybookAddress) => string[];
  readonly cutAt: () => number | undefined;
  readonly uncut: () => void;
  readonly cutAfter: (count: number) => void;
}

function keptInMemory(goals: PlaybookGoals): Kept {
  const reservations = new Map<string, ImportMark>();
  const standings = new Map<string, ImportStanding>();
  const copies = new Map<string, string[]>();
  const cut: { at?: number } = {};
  return {
    goals,
    reservationOf: (address) => reservations.get(keyOf(address)),
    reserve: (address, mark) => {
      reservations.set(keyOf(address), mark);
    },
    release: (address) => {
      reservations.delete(keyOf(address));
    },
    standingOf: (address) => standings.get(keyOf(address)) ?? { finished: false },
    keep: (address, standing) => {
      standings.set(keyOf(address), standing);
    },
    copyOf: (address) => {
      const copy = copies.get(keyOf(address)) ?? [];
      copies.set(keyOf(address), copy);
      return copy;
    },
    cutAt: () => cut.at,
    uncut: () => {
      delete cut.at;
    },
    cutAfter: (count) => {
      cut.at = count;
    },
  };
}

function releasedFrom(kept: Kept) {
  return (address: PlaybookAddress, importId: string) =>
    Effect.sync(() => {
      if (kept.reservationOf(address)?.import_id === importId) {
        kept.release(address);
      }
    });
}

function copiedInto(kept: Kept, address: PlaybookAddress, names: readonly string[]) {
  const copy = kept.copyOf(address);
  const left = names.filter((named) => !copy.includes(named));
  const at = kept.cutAt();
  const copying = at === undefined ? left : left.slice(0, Math.max(0, at - copy.length));
  copy.push(...copying);
  if (copying.length < left.length) {
    kept.uncut();
    return Effect.fail(new Unavailable({ detail: 'The import was cut' }));
  }
  kept.keep(address, { ...kept.standingOf(address), finished: true });
  return Effect.void;
}

function heldIn({ goals }: Kept, address: PlaybookAddress) {
  return Effect.map(goals.read(address), (held): ImportedInItsObject => ({ held, modelsNotOffered: [] }));
}

function inANewPlaybook(kept: Kept, address: PlaybookAddress, asked: ImportAsked<CheckedGoals>, mark: ImportMark) {
  return Effect.gen(function* () {
    const issues = issuesOf(asked.package);
    if (asked.goals === undefined || issues.length > 0) {
      const refused: ImportedInItsObject = { issues };
      return refused;
    }
    kept.keep(address, { ...kept.standingOf(address), started: mark });
    const { page, definitions } = asked.package;
    yield* Effect.orDie(
      kept.goals.save(address, { ...(page === undefined ? {} : { page }), goals: asked.goals, onlyIfNone: true }),
    );
    yield* copiedInto(
      kept,
      address,
      definitions.map(({ name }) => name),
    );
    return yield* heldIn(kept, address);
  });
}

function inARegisteredPlaybook(kept: Kept, address: PlaybookAddress, mark: ImportMark) {
  return Effect.gen(function* () {
    const { started } = kept.standingOf(address);
    if (started === undefined) {
      const taken: ImportedInItsObject = { taken: true };
      return taken;
    }
    const refusal = refusalOf(started, mark);
    if (refusal !== undefined) {
      return yield* refusal;
    }
    return yield* heldIn(kept, address);
  });
}

function reservedIn(kept: Kept) {
  return (address: PlaybookAddress, importId: string, written: ImportedPackage) => {
    const mark = { import_id: importId, digest: digestOf(written) };
    const refusal = refusalOf(kept.reservationOf(address), mark);
    if (refusal !== undefined) {
      return Effect.fail(refusal);
    }
    kept.reserve(address, mark);
    return Effect.void;
  };
}

export function importsInItsObjectInMemory(goals: PlaybookGoals): ImportsInItsObjectInMemory {
  const kept = keptInMemory(goals);
  return {
    reserve: reservedIn(kept),
    imported: (address, asked) => {
      const mark = { import_id: asked.import_id, digest: digestOf(asked.package) };
      return kept.reservationOf(address)?.import_id === asked.import_id
        ? inANewPlaybook(kept, address, asked, mark)
        : inARegisteredPlaybook(kept, address, mark);
    },
    released: releasedFrom(kept),
    finished: releasedFrom(kept),
    copied: (address) => [...kept.copyOf(address)],
    reservedFor: (address) => kept.reservationOf(address)?.import_id,
    cutAfter: kept.cutAfter,
  };
}
