import type { Caller, Conflict, InvalidInput, Issue, PlaybookAddress, Unavailable } from '@on.auto/operations';
import type { Effect } from 'effect';

import type { CheckedGoals, PlaybookHeld } from '../goals/playbook-goals.ts';

export interface PackageDefinition {
  readonly type: string;
  readonly name: string;
  readonly source: string;
  readonly overview?: string;
  readonly diagram?: string;
  readonly paused: boolean;
}

export interface ImportedPackage {
  readonly format: number;
  readonly page?: string;
  readonly goals?: string;
  readonly definitions: readonly PackageDefinition[];
}

export interface ImportMark {
  readonly import_id: string;
  readonly digest: string;
}

export interface ImportStanding {
  readonly started?: ImportMark;
  readonly finished: boolean;
}

export interface ImportPlanned {
  readonly digest: string;
  readonly modelsNotOffered: readonly string[];
}

export interface ImportChecks<Plan extends ImportPlanned> {
  readonly issues: readonly Issue[];
  readonly plan: Plan;
}

export interface PlaybookImports<Plan extends ImportPlanned = ImportPlanned> {
  readonly check: (playbook: PlaybookAddress, written: ImportedPackage) => Effect.Effect<ImportChecks<Plan>>;
  readonly standing: (playbook: PlaybookAddress) => Effect.Effect<ImportStanding>;
  readonly start: (playbook: PlaybookAddress, mark: ImportMark) => Effect.Effect<void, Conflict, Caller>;
  readonly copy: (
    playbook: PlaybookAddress,
    plan: Plan,
    mark: ImportMark,
  ) => Effect.Effect<void, InvalidInput | Conflict | Unavailable, Caller>;
}

export interface ImportAsked<Checked extends CheckedGoals> {
  readonly import_id: string;
  readonly package: ImportedPackage;
  readonly goals?: Checked;
}

export type ImportedInItsObject =
  | { readonly issues: readonly Issue[] }
  | { readonly held: PlaybookHeld; readonly modelsNotOffered: readonly string[] }
  | { readonly taken: true };

export interface PlaybookImportsInItsObject<Checked extends CheckedGoals = CheckedGoals> {
  readonly reserve: (
    playbook: PlaybookAddress,
    importId: string,
    written: ImportedPackage,
  ) => Effect.Effect<void, Conflict | Unavailable>;
  readonly imported: (
    playbook: PlaybookAddress,
    asked: ImportAsked<Checked>,
  ) => Effect.Effect<ImportedInItsObject, InvalidInput | Conflict | Unavailable, Caller>;
  readonly released: (playbook: PlaybookAddress, importId: string) => Effect.Effect<void>;
  readonly finished: (playbook: PlaybookAddress, importId: string) => Effect.Effect<void>;
}
