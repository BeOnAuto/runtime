import type {
  CallerIdentity,
  CallLink,
  Conflict,
  InvalidInput,
  Issue,
  Noun,
  Settlement,
  TriggerLink,
  Unavailable,
} from '@on.auto/operations';
import type { CallEnded, CallStarted } from '@on.auto/tool-servers';
import { Effect, type Schema } from 'effect';

import { composedOverview, type OverviewParts } from '../overview/definition-overview.ts';
import type { Trigger } from '../registry/definition-triggers.ts';
import { noFacts, type CapabilityFacts } from '../run-work/declared-facts.ts';
import type { CancelRequestKind } from '../runs/run-events.ts';
import type { RecordedAnswer, RecordedWork } from '../runs/run-state.ts';
import type { SavedDefinitions } from './saved-definitions.ts';
import { noStrippedForms, type StrippedForms } from './stripped-forms.ts';

export interface DefinitionSummary {
  readonly description?: string;
  readonly about?: string;
  readonly inputSchema?: Schema.JsonObject;
  readonly outputSchema?: Schema.JsonObject;
  readonly warnings?: readonly string[];
  readonly triggers?: readonly Trigger[];
  readonly details?: Schema.JsonObject;
}

export interface StandingRequest {
  readonly org: string;
  readonly playbook: string;
  readonly name: string;
  readonly version: number;
  readonly status: 'active' | 'retired';
  readonly details?: Schema.JsonObject;
}

export type Standing = (request: StandingRequest) => Effect.Effect<Schema.JsonObject | undefined>;

export interface ToolCallJournal {
  readonly started: (fact: CallStarted) => Effect.Effect<number | undefined>;
  readonly ended: (number: number, fact: CallEnded) => Effect.Effect<boolean>;
}

export interface RunLineage {
  readonly startId: string;
  readonly correlationId: string;
}

export interface RunContext {
  readonly id: string;
  readonly org: string;
  readonly playbook: string;
  readonly caller: CallerIdentity;
  readonly definition: { readonly name: string; readonly version: number };
  readonly journal: ToolCallJournal;
  readonly lineage: RunLineage;
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy?: CallLink;
  readonly trigger?: TriggerLink;
  readonly longestRunOf: (type: string, name: string) => Effect.Effect<number | undefined>;
  readonly longestRunFor: (type: string, name: string, input: Schema.Json) => Effect.Effect<number | undefined>;
}

export interface Finished {
  readonly output: Schema.Json;
  readonly record: Schema.JsonObject;
}

export interface FinishesLater {
  readonly finishesLater: true;
  readonly record: Schema.JsonObject;
}

export type CapabilityAnswer = Finished | FinishesLater;

export type CapabilityRejection = InvalidInput | Unavailable | Conflict;

export interface CancelledRun {
  readonly run: { readonly org: string; readonly playbook: string; readonly id: string };
  readonly record: Schema.JsonObject;
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly answer: RecordedAnswer | null;
  readonly work: readonly RecordedWork[];
}

export type CancelDecision = (run: CancelledRun) => Settlement;

export interface CapabilityGuide {
  readonly name: string;
  readonly onThisServer?: string;
}

export interface RunAccount {
  readonly summary: string;
  readonly data: { readonly [field: string]: Schema.Json };
}

export interface RunWords {
  readonly deferralType: string;
  readonly deferral: (record: Schema.JsonObject) => RunAccount | undefined;
}

type WhenCancelled = 'stop' | 'finish';

export interface AnsweringRun {
  readonly work: readonly RecordedWork[];
}

export type AnswerIssues = (answer: Schema.Json, run: AnsweringRun) => readonly Issue[];

export type OverviewContext = Readonly<{ summary: DefinitionSummary }>;

export type OverviewOf<Parsed> = (parsed: Parsed, name: string, context: OverviewContext) => OverviewParts;

const defaultLongestAnyRunMs = 600_000;

export interface CapabilityDeclaration<Parsed> {
  readonly type: string;
  readonly title: string;
  readonly guide: CapabilityGuide;
  readonly noun: Noun;
  readonly describeOutput: (output: Schema.Json, record?: Schema.JsonObject) => string;
  readonly mediaType: string;
  readonly parse: (source: string) => Effect.Effect<Parsed, InvalidInput>;
  readonly check?: (
    parsed: NoInfer<Parsed>,
    source: string,
    saved: SavedDefinitions,
  ) => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;
  readonly summarize: (parsed: NoInfer<Parsed>) => DefinitionSummary;
  readonly overview?: OverviewOf<NoInfer<Parsed>>;
  readonly run: (
    parsed: NoInfer<Parsed>,
    input: Schema.Json,
    context: RunContext,
    stripped: StrippedForms,
  ) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
  readonly whenCancelled?: WhenCancelled;
  readonly longestAnyRunMs?: number;
  readonly reachesOutside?: boolean;
  readonly mayChangeOutside?: boolean;
  readonly callsTools?: (parsed: NoInfer<Parsed>) => boolean;
  readonly finishesLater?: boolean | ((parsed: NoInfer<Parsed>) => boolean);
  readonly finishesLaterFor?: (parsed: NoInfer<Parsed>, input: Schema.Json) => boolean;
  readonly answersItsShapeFor?: (parsed: NoInfer<Parsed>, input: Schema.Json) => boolean;
  readonly longestRunOf?: (parsed: NoInfer<Parsed>) => number;
  readonly longestRunFor?: (parsed: NoInfer<Parsed>, input: Schema.Json) => number;
  readonly cancel?: CancelDecision;
  readonly answerIssues?: AnswerIssues;
  readonly runWords?: Partial<RunWords>;
  readonly facts?: CapabilityFacts;
  readonly mostActive?: number;
  readonly standing?: Standing;
}

export interface PreparedDefinition {
  readonly summary: DefinitionSummary;
  readonly overview: (name: string) => ReturnType<typeof composedOverview>;
  readonly check: (saved: SavedDefinitions) => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;
  readonly run: (input: Schema.Json, context: RunContext) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
  readonly whenCancelled: WhenCancelled;
  readonly callsTools: boolean;
  readonly finishesLaterFor: (input: Schema.Json) => boolean;
  readonly answersItsShapeFor: (input: Schema.Json) => boolean;
  readonly longestRunMs: number;
  readonly longestRunMsFor: (input: Schema.Json) => number;
}

function callsNoTools(): boolean {
  return false;
}

function noDeferralShown(): undefined {
  return undefined;
}

export const defaultRunWords: RunWords = { deferralType: 'run_deferred', deferral: noDeferralShown };

export function cancelledAsAsked({ kind, reason }: CancelledRun): Settlement {
  return { status: 'rejected', reason: 'cancelled', kind, detail: reason };
}

function takesAnyAnswer(): readonly Issue[] {
  return [];
}

function standsAsSaved(): Effect.Effect<Schema.JsonObject | undefined> {
  return Effect.undefined;
}

function needsNoCheck(): Effect.Effect<StrippedForms> {
  return Effect.succeed(noStrippedForms);
}

export interface Capability {
  readonly type: string;
  readonly title: string;
  readonly guide: CapabilityGuide;
  readonly noun: Noun;
  readonly describeOutput: (output: Schema.Json, record?: Schema.JsonObject) => string;
  readonly mediaType: string;
  readonly longestAnyRunMs: number;
  readonly reachesOutside: boolean;
  readonly mayChangeOutside: boolean;
  readonly mostActive: number;
  readonly standing: Standing;
  readonly cancel: CancelDecision;
  readonly answerIssues: AnswerIssues;
  readonly runWords: RunWords;
  readonly facts: CapabilityFacts;
  readonly prepare: (source: string, stripped?: StrippedForms) => Effect.Effect<PreparedDefinition, InvalidInput>;
}

const definitionTypePattern = /^[a-z][a-z0-9-]{2,31}$/u;

export function isDefinitionTypeName(name: string): boolean {
  return definitionTypePattern.test(name);
}

function declaredBounds<Parsed>(definition: CapabilityDeclaration<Parsed>) {
  return {
    longestAnyRunMs: definition.longestAnyRunMs ?? defaultLongestAnyRunMs,
    reachesOutside: definition.reachesOutside ?? false,
    mayChangeOutside: definition.mayChangeOutside ?? false,
    mostActive: definition.mostActive ?? Number.POSITIVE_INFINITY,
    standing: definition.standing ?? standsAsSaved,
    cancel: definition.cancel ?? cancelledAsAsked,
    answerIssues: definition.answerIssues ?? takesAnyAnswer,
    runWords: { ...defaultRunWords, ...definition.runWords },
    facts: definition.facts ?? noFacts,
  };
}

function finishingOf<Parsed>(declared: CapabilityDeclaration<Parsed>['finishesLater']): (parsed: Parsed) => boolean {
  return typeof declared === 'function' ? declared : () => declared ?? false;
}

function declaredLengths<Parsed>(definition: CapabilityDeclaration<Parsed>, longestAnyRunMs: number) {
  const finishesLater = finishingOf<Parsed>(definition.finishesLater);
  const longestRunOf = definition.longestRunOf ?? (() => longestAnyRunMs);
  return {
    finishesLaterFor: definition.finishesLaterFor ?? finishesLater,
    longestRunOf,
    longestRunFor: definition.longestRunFor ?? longestRunOf,
  };
}

function declaredRuns<Parsed>(definition: CapabilityDeclaration<Parsed>, longestAnyRunMs: number) {
  return {
    check: definition.check ?? needsNoCheck,
    whenCancelled: definition.whenCancelled ?? 'stop',
    callsTools: definition.callsTools ?? callsNoTools,
    answersItsShapeFor: definition.answersItsShapeFor ?? (() => true),
    ...declaredLengths(definition, longestAnyRunMs),
  };
}

export function defineCapability<Parsed>(definition: CapabilityDeclaration<Parsed>): Capability {
  const { type, title, guide, noun, describeOutput, mediaType, parse, summarize, overview, run } = definition;
  const bounds = declaredBounds(definition);
  const { check, whenCancelled, callsTools, answersItsShapeFor, finishesLaterFor, longestRunOf, longestRunFor } =
    declaredRuns(definition, bounds.longestAnyRunMs);
  if (!isDefinitionTypeName(type)) {
    throw new Error(`The type ${type} is malformed`);
  }
  return {
    type,
    title,
    guide,
    noun,
    describeOutput,
    mediaType,
    ...bounds,
    prepare: (source, stripped = noStrippedForms) =>
      parse(source).pipe(
        Effect.map((parsed) => {
          const summary = summarize(parsed);
          return {
            summary,
            overview: (name) => composedOverview({ name, noun, summary, parts: overview?.(parsed, name, { summary }) }),
            check: (saved) => Effect.suspend(() => check(parsed, source, saved)),
            run: (input, context) => run(parsed, input, context, stripped),
            whenCancelled,
            callsTools: callsTools(parsed),
            finishesLaterFor: (input) => finishesLaterFor(parsed, input),
            answersItsShapeFor: (input) => answersItsShapeFor(parsed, input),
            longestRunMs: longestRunOf(parsed),
            longestRunMsFor: (input) => longestRunFor(parsed, input),
          };
        }),
      ),
  };
}
