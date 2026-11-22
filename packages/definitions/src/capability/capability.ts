import type {
  Conflict,
  IncompleteDetails,
  InvalidInput,
  Notice,
  PlaybookAddress,
  RunCancelled,
  Unavailable,
} from '@on.auto/operations';
import type { Noun } from '@on.auto/phrasing';
import { Effect, type Schema } from 'effect';

import {
  cancelledAsAsked,
  nothingToEnd,
  type CancelDecision,
  type CancelledAttempt,
  type Resumption,
} from '../cancellation/cancelled-runs.ts';
import type { Trigger } from '../registry/definition-triggers.ts';
import { noFacts, type CapabilityFacts } from '../run-work/declared-facts.ts';
import type { DefinitionsNamed } from '../used-by/definitions-named.ts';
import type { RunAttempt, RunContext } from './run-context.ts';
import { noStrippedForms, type StrippedForms } from './stripped-forms.ts';

export {
  cancelledAsAsked,
  type CancelDecision,
  type CancelledAttempt,
  type CancelledRun,
  type Resumption,
} from '../cancellation/cancelled-runs.ts';

export interface DefinitionSummary {
  readonly title?: string;
  readonly description?: string;
  readonly inputSchema?: Schema.JsonObject;
  readonly outputSchema?: Schema.JsonObject;
  readonly warnings?: readonly string[];
  readonly triggers?: readonly Trigger[];
  readonly details?: Schema.JsonObject;
}

export interface DefinitionPlace extends PlaybookAddress {
  readonly name?: string;
}

export interface StandingRequest {
  readonly org: string;
  readonly playbook: string;
  readonly definition: string;
  readonly name: string;
  readonly version: number;
  readonly status: 'active' | 'retired';
  readonly details?: Schema.JsonObject;
}

export type Standing = (request: StandingRequest) => Effect.Effect<Schema.JsonObject | undefined>;

export interface Finished {
  readonly output: Schema.Json;
  readonly record: Schema.JsonObject;
  readonly incomplete_details?: IncompleteDetails;
}

export interface FinishesLater {
  readonly finishesLater: true;
  readonly record: Schema.JsonObject;
}

export type CapabilityAnswer = Finished | FinishesLater;

export type CapabilityRejection = InvalidInput | Unavailable | Conflict | RunCancelled;

export type GuideVariables = Readonly<Record<string, { readonly value: string; readonly default: string }>>;

export interface CapabilityGuide {
  readonly name: string;
  readonly onThisServer?: string;
  readonly variables?: GuideVariables;
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
    place: DefinitionPlace,
  ) => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;
  readonly notices?: (parsed: NoInfer<Parsed>, place: PlaybookAddress) => Effect.Effect<readonly Notice[]>;
  readonly summarize: (parsed: NoInfer<Parsed>) => DefinitionSummary;
  readonly definitionsNamed?: (parsed: NoInfer<Parsed>) => DefinitionsNamed;
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
  readonly outsideTheDirectoryListing?: true;
  readonly callsTools?: (parsed: NoInfer<Parsed>) => boolean;
  readonly finishesLater?: boolean | ((parsed: NoInfer<Parsed>) => boolean);
  readonly finishesLaterFor?: (parsed: NoInfer<Parsed>, input: Schema.Json) => boolean;
  readonly answersItsShapeFor?: (parsed: NoInfer<Parsed>, input: Schema.Json) => boolean;
  readonly longestRunOf?: (parsed: NoInfer<Parsed>) => number;
  readonly longestRunFor?: (parsed: NoInfer<Parsed>, input: Schema.Json) => number;
  readonly resumes?: Resumption<NoInfer<Parsed>>;
  readonly cancel?: CancelDecision;
  readonly runWords?: Partial<RunWords>;
  readonly facts?: CapabilityFacts;
  readonly mostActive?: number;
  readonly standing?: Standing;
}

export interface PreparedDefinition {
  readonly summary: DefinitionSummary;
  readonly check: (place: DefinitionPlace) => Effect.Effect<StrippedForms, InvalidInput | Unavailable>;
  readonly notices?: (place: PlaybookAddress) => Effect.Effect<readonly Notice[]>;
  readonly definitionsNamed?: DefinitionsNamed;
  readonly run: (input: Schema.Json, context: RunContext) => Effect.Effect<CapabilityAnswer, CapabilityRejection>;
  readonly whenCancelled: WhenCancelled;
  readonly cancelledAttempt: (attempt: RunAttempt) => CancelledAttempt;
  readonly callsTools: boolean;
  readonly finishesLaterFor: (input: Schema.Json) => boolean;
  readonly answersItsShapeFor: (input: Schema.Json) => boolean;
  readonly longestRunMs: number;
  readonly longestRunMsFor: (input: Schema.Json) => number;
  readonly resumesAfterMs: number;
}

function callsNoTools(): boolean {
  return false;
}

function noDeferralShown(): undefined {
  return undefined;
}

export const defaultRunWords: RunWords = { deferralType: 'run_deferred', deferral: noDeferralShown };

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
  readonly outsideTheDirectoryListing?: true;
  readonly mostActive: number;
  readonly standing: Standing;
  readonly cancel: CancelDecision;
  readonly runWords: RunWords;
  readonly facts: CapabilityFacts;
  readonly resumes: boolean;
  readonly prepare: (source: string, stripped?: StrippedForms) => Effect.Effect<PreparedDefinition, InvalidInput>;
}

export const capabilityContract = 9;

export const earliestCapabilityContractServed = 2;

export const predictionCapabilityPoint = 'capability/prediction';

const definitionTypePattern = /^[a-z][a-z0-9-]{2,31}$/u;

export function isDefinitionTypeName(name: string): boolean {
  return definitionTypePattern.test(name);
}

const outsideTheListing: Pick<Capability, 'outsideTheDirectoryListing'> = { outsideTheDirectoryListing: true };

function listingOf<Parsed>(definition: CapabilityDeclaration<Parsed>): Pick<Capability, 'outsideTheDirectoryListing'> {
  return definition.outsideTheDirectoryListing === true ? outsideTheListing : {};
}

function declaredBounds<Parsed>(definition: CapabilityDeclaration<Parsed>) {
  return {
    longestAnyRunMs: definition.longestAnyRunMs ?? defaultLongestAnyRunMs,
    reachesOutside: definition.reachesOutside ?? false,
    mayChangeOutside: definition.mayChangeOutside ?? false,
    mostActive: definition.mostActive ?? Number.POSITIVE_INFINITY,
    standing: definition.standing ?? standsAsSaved,
    cancel: definition.cancel ?? cancelledAsAsked,
    runWords: { ...defaultRunWords, ...definition.runWords },
    facts: definition.facts ?? noFacts,
    ...listingOf(definition),
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

function noticesOf<Parsed>(
  { notices }: CapabilityDeclaration<Parsed>,
  parsed: Parsed,
): Pick<PreparedDefinition, 'notices'> {
  return notices === undefined ? {} : { notices: (place) => Effect.suspend(() => notices(parsed, place)) };
}

function namedIn<Parsed>(
  { definitionsNamed }: CapabilityDeclaration<Parsed>,
  parsed: Parsed,
): Pick<PreparedDefinition, 'definitionsNamed'> {
  return definitionsNamed === undefined ? {} : { definitionsNamed: definitionsNamed(parsed) };
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
  const { type, title, guide, noun, describeOutput, mediaType, parse, summarize, run } = definition;
  const bounds = declaredBounds(definition);
  const { check, whenCancelled, callsTools, answersItsShapeFor, finishesLaterFor, longestRunOf, longestRunFor } =
    declaredRuns(definition, bounds.longestAnyRunMs);
  const { resumes: resumption } = definition;
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
    resumes: resumption !== undefined,
    prepare: (source, stripped = noStrippedForms) => {
      const preparedFrom = (parsed: Parsed): PreparedDefinition => ({
        summary: summarize(parsed),
        check: (place) => Effect.suspend(() => check(parsed, source, place)),
        ...noticesOf(definition, parsed),
        ...namedIn(definition, parsed),
        run: (input, context) => run(parsed, input, context, stripped),
        whenCancelled,
        cancelledAttempt: (attempt) => resumption?.cancelledAttempt(parsed, attempt) ?? nothingToEnd,
        callsTools: callsTools(parsed),
        finishesLaterFor: (input) => finishesLaterFor(parsed, input),
        answersItsShapeFor: (input) => answersItsShapeFor(parsed, input),
        longestRunMs: longestRunOf(parsed),
        longestRunMsFor: (input) => longestRunFor(parsed, input),
        resumesAfterMs: resumption?.afterMs(parsed) ?? Number.POSITIVE_INFINITY,
      });
      return parse(source).pipe(Effect.map(preparedFrom));
    },
  };
}
