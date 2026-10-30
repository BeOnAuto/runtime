import {
  capabilityContract,
  type CancelDecision,
  type CancelledAttempt,
  type Capability,
  type CapabilityAnswer,
  type CapabilityRejection,
  type DeclaredFact,
  type DefinitionSummary,
  type PlaybookOperation,
  type PreparedDefinition,
  type RunAccount,
  type RunAttempt,
  type RunContext,
  type RunJournal,
  type RunLineage,
  type Standing,
  type StrippedForms,
} from '@on.auto/definitions';
import type { FeatureAsked, FeatureUse } from '@on.auto/meter';
import type {
  CallerIdentity,
  CallLink,
  Conflict,
  InvalidInput,
  Presenter,
  Registration,
  TriggerLink,
  Unavailable,
} from '@on.auto/operations';
import type { JudgedEvent, MatchedFilter, PageVerdicts, ProgramPool } from '@on.auto/workflow-engine/dsl';
import type { Effect, Schema } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  CapabilityDatabase,
  CapabilityPorts,
  DatabaseFailed,
  DueItem,
  DueWork,
  FoldedChanges,
  Folder,
  HostDatabase,
  KeptOf,
  PassedChange,
  PassedRow,
  ProvidedCapability,
  ReadPage,
  ReadStatement,
  Reconciled,
  Reconciling,
  RowPhase,
  SomeFolder,
  Statement,
  Writing,
} from '../index.ts';

type Row = PassedRow;

type Change = PassedChange<Row>;

interface ContractOne {
  readonly capability: {
    readonly type: string;
    readonly title: string;
    readonly guide: { readonly name: string; readonly onThisServer?: string };
    readonly noun: { readonly one: string; readonly other: string };
    readonly describeOutput: (output: Schema.Json, record?: Schema.JsonObject) => string;
    readonly mediaType: string;
    readonly longestAnyRunMs: number;
    readonly reachesOutside: boolean;
    readonly mayChangeOutside: boolean;
    readonly mostActive: number;
    readonly standing: Standing;
    readonly cancel: CancelDecision;
    readonly runWords: {
      readonly deferralType: string;
      readonly deferral: (record: Schema.JsonObject) => RunAccount | undefined;
    };
    readonly facts: { readonly onRuns: readonly DeclaredFact[]; readonly streams: readonly Presenter[] };
    readonly resumes: boolean;
    readonly prepare: (source: string, stripped?: StrippedForms) => Effect.Effect<PreparedDefinition, InvalidInput>;
  };
  readonly prepared: {
    readonly summary: DefinitionSummary;
    readonly check: () => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;
    readonly run: (input: Schema.Json, context: RunContext) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
    readonly whenCancelled: 'stop' | 'finish';
    readonly cancelledAttempt: (attempt: RunAttempt) => CancelledAttempt;
    readonly callsTools: boolean;
    readonly finishesLaterFor: (input: Schema.Json) => boolean;
    readonly answersItsShapeFor: (input: Schema.Json) => boolean;
    readonly longestRunMs: number;
    readonly longestRunMsFor: (input: Schema.Json) => number;
    readonly resumesAfterMs: number;
  };
  readonly runContext: {
    readonly id: string;
    readonly org: string;
    readonly playbook: string;
    readonly caller: CallerIdentity;
    readonly definition: { readonly name: string; readonly version: number };
    readonly journal: RunJournal;
    readonly lineage: RunLineage;
    readonly depth: number;
    readonly callDepth: number;
    readonly calledBy?: CallLink;
    readonly trigger?: TriggerLink;
    readonly longestRunOf: (type: string, name: string) => Effect.Effect<number | undefined>;
    readonly longestRunFor: (type: string, name: string, input: Schema.Json) => Effect.Effect<number | undefined>;
    readonly resumesAfterOf: (type: string, name: string) => Effect.Effect<number | undefined>;
  };
  readonly provided: {
    readonly capability: Capability;
    readonly folders?: readonly SomeFolder[];
    readonly operations?: readonly PlaybookOperation[];
    readonly dueWork?: readonly DueWork[];
  };
  readonly ports: {
    readonly database: CapabilityDatabase;
    readonly pool: Omit<ProgramPool, 'close'>;
    readonly filters: {
      readonly verdictsOf: (filters: readonly MatchedFilter[], events: readonly JudgedEvent[]) => Promise<PageVerdicts>;
    };
    readonly features: {
      readonly includes: (asked: FeatureAsked) => Effect.Effect<boolean, Unavailable>;
      readonly refusal: (use: FeatureUse) => Effect.Effect<Conflict, Unavailable>;
    };
    readonly settings: ReadonlyMap<string, string>;
    readonly mostFunctions: number;
    readonly triesBeforeStall: number;
  };
  readonly database: {
    readonly read: (statement: Statement) => Effect.Effect<readonly unknown[], DatabaseFailed>;
    readonly write: (statement: Statement) => Effect.Effect<readonly unknown[], DatabaseFailed>;
    readonly transaction: (statements: readonly Statement[]) => Effect.Effect<readonly unknown[], DatabaseFailed>;
    readonly readConsistently: <A, E>(
      reads: (read: ReadStatement) => Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | DatabaseFailed>;
  };
  readonly folder: {
    readonly definitionType: string;
    readonly tables: readonly Statement[];
    readonly rebuildsAtOnce: number;
    readonly keptOf: KeptOf;
    readonly keyOf: (row: Row) => string;
    readonly typesOf: (row: Row) => readonly string[];
    readonly playbooksWithRows: (database: HostDatabase) => Effect.Effect<readonly string[], DatabaseFailed>;
    readonly rowsOf: (database: HostDatabase, playbook: string) => Effect.Effect<readonly Row[], DatabaseFailed>;
    readonly reconcile: (reconciling: Reconciling, rows: readonly Row[]) => Reconciled<Row>;
    readonly dropped: (row: Row) => readonly Statement[];
    readonly phased: (row: Row, phase: RowPhase) => Statement;
    readonly fold: (
      rows: readonly Row[],
      page: ReadPage,
      database: HostDatabase,
    ) => Effect.Effect<FoldedChanges<Change>, DatabaseFailed>;
    readonly write: (writing: Writing, change: Change) => Effect.Effect<Row | undefined, DatabaseFailed>;
    readonly unchanged: (row: Row) => Change;
    readonly joinedLive: (change: Change) => Change;
    readonly hasChanged: (change: Change) => boolean;
  };
  readonly dueWork: {
    readonly name: string;
    readonly due: (now: number, most: number, callsOut: boolean) => Effect.Effect<readonly DueItem[], unknown>;
    readonly nextDueAt: (after: number, callsOut?: boolean) => Effect.Effect<number | null, unknown>;
  };
  readonly dueItem: {
    readonly key: string;
    readonly callsOut: boolean;
    readonly perform: (now: number) => Effect.Effect<void, unknown>;
  };
  readonly playbookOperation: { readonly registration: Registration<'playbook'> };
}

interface TypesOfEachContract {
  readonly 1: ContractOne;
}

type ThisContract = TypesOfEachContract[typeof capabilityContract];

describe('the contract by which a capability is made and served', () => {
  it('holds the members and the types its version names, so that a change to either raises capabilityContract', () => {
    expectTypeOf<Capability>().toEqualTypeOf<ThisContract['capability']>();
    expectTypeOf<PreparedDefinition>().toEqualTypeOf<ThisContract['prepared']>();
    expectTypeOf<RunContext>().toEqualTypeOf<ThisContract['runContext']>();
    expectTypeOf<ProvidedCapability>().toEqualTypeOf<ThisContract['provided']>();
    expectTypeOf<CapabilityPorts>().toEqualTypeOf<ThisContract['ports']>();
    expectTypeOf<CapabilityDatabase>().toEqualTypeOf<ThisContract['database']>();
    expectTypeOf<Folder<Row, Change>>().toEqualTypeOf<ThisContract['folder']>();
    expectTypeOf<DueWork>().toEqualTypeOf<ThisContract['dueWork']>();
    expectTypeOf<DueItem>().toEqualTypeOf<ThisContract['dueItem']>();
    expectTypeOf<PlaybookOperation>().toEqualTypeOf<ThisContract['playbookOperation']>();
    expect(capabilityContract).toBe(1);
  });
});
