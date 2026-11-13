import { Conflict, InvalidInput, Unavailable, type RunCancelled } from '@on.auto/operations';
import { Effect } from 'effect';

import type { FailureIssue } from '../failure/failure-issue.ts';
import type { AdmissionFailure } from '../failure/request-failure.ts';
import type { FailedCall } from '../steps/step-decision.ts';
import { counted, unavailableAfter, unfinishedAfter, type Spent, type ToolUse } from '../tools/tool-endings.ts';
import type { BeforeTheSteps } from './before-the-steps.ts';

export type DefinitionRejection = InvalidInput | Unavailable | Conflict | RunCancelled;

export interface RejectionContext {
  readonly maxOutputTokens: number;
  readonly spent: Spent;
  readonly use: ToolUse;
  readonly lastInputTokens: number | null;
  readonly answeredBytes: number;
}

type Rejected = Effect.Effect<never, DefinitionRejection>;

const mostIssues = 5;

function listed(issues: readonly FailureIssue[]): string {
  const shown = issues.slice(0, mostIssues).map(({ pointer, detail }) => `${pointer}: ${detail}`);
  return shown.length === 0 ? '' : ` (${shown.join('; ')})`;
}

export function waitFor(retryAfterMs: number | undefined): string {
  if (retryAfterMs === undefined) {
    return 'later';
  }
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return seconds === 1 ? 'in 1 second' : `in ${seconds} seconds`;
}

export function saidBy(providerMessage: string | undefined): string {
  return providerMessage === undefined ? '' : `. The provider said: ${providerMessage}`;
}

function lastTurnInWords(inputTokens: number | null): string {
  return inputTokens === null
    ? ''
    : `, and the provider counted ${counted.format(inputTokens)} input tokens in the last turn it answered`;
}

function adviceOn({ answeredBytes, lastInputTokens }: RejectionContext): string {
  return answeredBytes > 0
    ? `; the tools of this run answered ${counted.format(answeredBytes)} bytes, which the model reads whole${lastTurnInWords(lastInputTokens)}, so ask the tools for a page of what they hold, or move each read into a lookup function, whose \`read\` keeps only the part the job needs`
    : '; shorten the prompt or the input of the reasoning function';
}

function unworkable(detail: string, spent: Spent = {}): Rejected {
  return Effect.fail(new Conflict({ detail, kind: 'unworkable', ...spent }));
}

const raiseTheLimit = 'raise config.max_output_tokens in the reasoning function definition';

function whatToMoveOut({ calledAny, onlyRead }: Pick<ToolUse, 'calledAny' | 'onlyRead'>): string {
  if (!calledAny) {
    return `; ${raiseTheLimit}, or, where one answer holds several pieces of work, give each piece a function of its own`;
  }
  return onlyRead
    ? `, after the run called tools that only read. Where the job always makes those reads, move each into a lookup function and hand this function what it read; or ${raiseTheLimit}`
    : `, after the run called tools. Where the job always makes a call, move it out of this function, a read into a lookup function and an act into an interaction function; or ${raiseTheLimit}`;
}

type Repaired = NonNullable<FailedCall['repair']>;

const skippedFor: Readonly<Record<Extract<Repaired, { readonly outcome: 'skipped' }>['because'], string>> = {
  input_tokens: 'the run had too few input tokens left',
  context_window: "it would not fit in the model's context window",
  time: 'too little time was left',
};

function repairedIn(detail: string, issues: readonly FailureIssue[], repair: Repaired | undefined): string {
  if (repair === undefined) {
    return `${detail}${listed(issues)}`;
  }
  if (repair.outcome === 'skipped') {
    return `${detail}${listed(issues)}; no correction was attempted, as ${skippedFor[repair.because]}`;
  }
  return repair.outcome === 'failed'
    ? `${detail}${listed(issues)}; the request for a correction failed (${repair.because})`
    : `${detail} after one correction${listed(issues)}`;
}

function outputRefused(failed: FailedCall, context: RejectionContext): Rejected {
  const { provider, detail, finish_reason: finishReason, issues = [], repair } = failed;
  const which = repair?.outcome === 'invalid' ? 'the corrected answer' : 'the answer';
  return finishReason === 'length'
    ? unworkable(
        `${provider} stopped ${which} at max_output_tokens (${context.maxOutputTokens}) before the JSON was complete${whatToMoveOut(context.use)}`,
        context.spent,
      )
    : unavailableAfter(context.use, repairedIn(detail, issues, repair), '; try again', context.spent);
}

type NotOfferedBecause = 'provider_not_configured' | 'model_not_allowed';

function notOffered(because: NotOfferedBecause, detail: string, spent: Spent = {}): Rejected {
  return Effect.fail(new Unavailable({ detail, kind: 'model_not_offered', because, ...spent }));
}

function notOfferedAfter(use: ToolUse, because: NotOfferedBecause, detail: string, spent: Spent): Rejected {
  return use.calledAny ? unavailableAfter(use, detail, '', spent) : notOffered(because, detail, spent);
}

const notTheSchema =
  ". The answer schema was not the cause; check the model's settings in the definition, such as temperature or reasoning, or choose another model";

function requestRefused(failed: FailedCall, { use, spent }: RejectionContext): Rejected {
  const { detail, provider_message: said, issues = [], schema_refusal: refusal } = failed;
  if (refusal?.outcome === 'skipped') {
    const notAskedAgain = '; too little time was left to ask again with the answer schema in the instructions';
    return unavailableAfter(use, `${detail}${notAskedAgain}`, `; try again${saidBy(said)}`, spent);
  }
  const advice = refusal?.outcome === 'refused_again' ? notTheSchema : '; update the reasoning function definition';
  return unworkable(`${detail}${listed(issues)}${advice}${saidBy(said)}`, spent);
}

const byReason: Readonly<Record<FailedCall['because'], (failed: FailedCall, context: RejectionContext) => Rejected>> = {
  definition_invalid: requestRefused,
  request_too_long: ({ detail, provider_message: said }, context) =>
    unworkable(`${detail}${adviceOn(context)}${saidBy(said)}`, context.spent),
  output_invalid: outputRefused,
  content_refused: ({ detail }, { spent }) =>
    Effect.fail(
      new InvalidInput({
        detail,
        issues: [{ pointer: '', detail: 'The model refused this input under its content policy' }],
        ...spent,
      }),
    ),
  rate_limited: ({ detail, retry_after_ms: wait }, { use, spent }) =>
    unavailableAfter(use, detail, `; try again ${waitFor(wait)}`, spent),
  provider_unavailable: ({ detail }, { use, spent }) => unavailableAfter(use, detail, '; try again later', spent),
  timed_out: ({ detail }, { use, spent }) => unavailableAfter(use, detail, '; try again later', spent),
  provider_not_configured: ({ detail }, { use, spent }) => unavailableAfter(use, detail, '', spent),
  model_not_allowed: ({ detail }, { use, spent }) => notOfferedAfter(use, 'model_not_allowed', detail, spent),
  credentials_rejected: ({ detail }, { use, spent }) => unavailableAfter(use, detail, '', spent),
};

export function recordedRejection(failed: FailedCall, context: RejectionContext): Rejected {
  return byReason[failed.because](failed, context);
}

interface Refused {
  readonly detail: string;
  readonly provider_message: string | null;
  readonly issues: readonly FailureIssue[];
}

interface UnconfiguredProvider {
  readonly detail: string;
  readonly provider: string;
  readonly configured: readonly string[];
}

function othersAreOffered({ provider, configured }: UnconfiguredProvider): boolean {
  return configured.length > 0 && !configured.includes(provider);
}

function notConfigured(failure: UnconfiguredProvider, { use, spent }: BeforeTheSteps): Rejected {
  return use.calledAny || othersAreOffered(failure)
    ? notOfferedAfter(use, 'provider_not_configured', failure.detail, spent)
    : Effect.fail(new Unavailable({ detail: failure.detail, ...spent }));
}

function invalidAfter({ use, spent }: BeforeTheSteps, { detail, provider_message: said, issues }: Refused): Rejected {
  return use.calledAny
    ? unfinishedAfter(use, 'definition_refused', `${detail}${listed(issues)}`, spent)
    : unworkable(
        `${detail}${listed(issues)}; update the reasoning function definition${saidBy(said ?? undefined)}`,
        spent,
      );
}

export function admitted(
  admission: Effect.Effect<void, AdmissionFailure>,
  before: BeforeTheSteps,
): Effect.Effect<void, DefinitionRejection> {
  const { use, spent, ended } = before;
  return admission.pipe(
    Effect.catchTags({
      definition_invalid: (refused: Refused) => Effect.andThen(ended, invalidAfter(before, refused)),
      provider_not_configured: (failure: UnconfiguredProvider) => Effect.andThen(ended, notConfigured(failure, before)),
      model_not_allowed: ({ detail }: { readonly detail: string }) =>
        Effect.andThen(ended, notOfferedAfter(use, 'model_not_allowed', detail, spent)),
    }),
  );
}
