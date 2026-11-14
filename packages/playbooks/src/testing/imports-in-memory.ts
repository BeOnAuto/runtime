import { Conflict, InvalidInput, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';

import type {
  ImportedPackage,
  ImportMark,
  ImportPlanned,
  ImportStanding,
  PlaybookImports,
} from '../imports/playbook-imports.ts';

export const refusedDefinition = 'refused';

interface PlanInMemory extends ImportPlanned {
  readonly names: readonly string[];
}

export interface ImportsInMemory extends PlaybookImports<PlanInMemory> {
  readonly copied: (address: PlaybookAddress) => readonly string[];
  readonly cutAfter: (count: number) => void;
}

function keyOf({ org, playbook }: PlaybookAddress): string {
  return `${org}/${playbook}`;
}

interface Kept {
  readonly standingOf: (address: PlaybookAddress) => ImportStanding;
  readonly keep: (address: PlaybookAddress, standing: ImportStanding) => void;
  readonly copyOf: (address: PlaybookAddress) => string[];
  readonly cutAt: () => number | undefined;
  readonly uncut: () => void;
}

function checkedIn(_address: PlaybookAddress, { definitions }: ImportedPackage) {
  return Effect.succeed({
    issues: definitions.flatMap(({ name }, index) =>
      name === refusedDefinition
        ? [{ pointer: `/package/definitions/${String(index)}`, detail: 'This definition is refused' }]
        : [],
    ),
    plan: { digest: JSON.stringify(definitions), modelsNotOffered: [], names: definitions.map(({ name }) => name) },
  });
}

function startedIn(kept: Kept, address: PlaybookAddress, mark: ImportMark) {
  const { started } = kept.standingOf(address);
  if (started === undefined) {
    kept.keep(address, { started: mark, finished: false });
    return Effect.void;
  }
  return started.import_id === mark.import_id && started.digest === mark.digest
    ? Effect.void
    : Effect.fail(new Conflict({ detail: 'Another import or another package' }));
}

function copiedIn(kept: Kept, address: PlaybookAddress, { names }: PlanInMemory) {
  const copy = kept.copyOf(address);
  const left = names.filter((named) => !copy.includes(named));
  const at = kept.cutAt();
  const copying = at === undefined ? left : left.slice(0, Math.max(0, at - copy.length));
  copy.push(...copying);
  if (copying.length < left.length) {
    kept.uncut();
    return Effect.fail(new InvalidInput({ detail: 'The import was cut', issues: [] }));
  }
  kept.keep(address, { ...kept.standingOf(address), finished: true });
  return Effect.void;
}

function keptInMemory(): Kept & { readonly cutAfter: (count: number) => void } {
  const standings = new Map<string, ImportStanding>();
  const copies = new Map<string, string[]>();
  const cut: { at?: number } = {};
  return {
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

export function importsInMemory(): ImportsInMemory {
  const kept = keptInMemory();
  return {
    check: checkedIn,
    standing: (address) => Effect.succeed(kept.standingOf(address)),
    start: (address, mark) => startedIn(kept, address, mark),
    copy: (address, plan) => copiedIn(kept, address, plan),
    copied: (address) => [...kept.copyOf(address)],
    cutAfter: kept.cutAfter,
  };
}
