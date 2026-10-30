import {
  CancelledKindSchema,
  ConflictKindSchema,
  InvalidInputKindSchema,
  LimitedBecauseSchema,
  UnansweredKindSchema,
  RejectionBecauseSchema,
  UnavailableKindSchema,
  asSentence,
  capitalized,
  counted,
  explanationOf,
  quoted,
} from '@on.auto/operations';
import type { InputReceipt, RunLogEvent, Step } from '@on.auto/workflow-engine';
import { Option, Schema } from 'effect';

const step = { one: 'step', other: 'steps' };

function happened(receipt: InputReceipt): string {
  if (receipt.kind === 'started') {
    return 'The workflow started';
  }
  if (receipt.kind === 'timer_fired') {
    return 'A timer of the workflow went off';
  }
  if (receipt.kind === 'call_answered') {
    return receipt.status === 'succeeded'
      ? 'A function the workflow called answered'
      : 'A function the workflow called did not succeed';
  }
  if (receipt.kind === 'event_received') {
    return 'The workflow received an event';
  }
  return receipt.kind === 'cancel_requested' && receipt.cancel !== undefined
    ? `${receipt.cancel.by} cancelled the workflow`
    : 'The workflow was asked to stop';
}

const decodeInvalidInputKind = Schema.decodeUnknownOption(InvalidInputKindSchema);

const decodeUnavailableKind = Schema.decodeUnknownOption(UnavailableKindSchema);

const decodeConflictKind = Schema.decodeUnknownOption(ConflictKindSchema);

const decodeCancelledKind = Schema.decodeUnknownOption(CancelledKindSchema);

const decodeUnansweredKind = Schema.decodeUnknownOption(UnansweredKindSchema);

const decodeBecause = Schema.decodeUnknownOption(RejectionBecauseSchema);

const decodeLimitedBecause = Schema.decodeUnknownOption(LimitedBecauseSchema);

type Rejection = NonNullable<Extract<InputReceipt, { readonly kind: 'call_answered' }>['rejection']> & {
  readonly limited_because?: string;
};

function becausesOf({ because, limited_because: limitedBecause }: Rejection) {
  const known = Option.getOrUndefined(decodeBecause(because));
  const limited = Option.getOrUndefined(decodeLimitedBecause(limitedBecause));
  return {
    ...(known === undefined ? {} : { because: known }),
    ...(limited === undefined ? {} : { limited_because: limited }),
  };
}

function whyNot(rejection: Rejection): string {
  const { kind } = rejection;
  const withBecause = becausesOf(rejection);
  const refused = Option.getOrUndefined(decodeInvalidInputKind(kind));
  if (refused !== undefined) {
    return explanationOf({ reason: 'invalid_input', kind: refused }).why;
  }
  const unavailable = Option.getOrUndefined(decodeUnavailableKind(kind));
  if (unavailable !== undefined) {
    return explanationOf({ reason: 'unavailable', kind: unavailable, ...withBecause }).why;
  }
  const conflict = Option.getOrUndefined(decodeConflictKind(kind));
  if (conflict !== undefined) {
    return explanationOf({ reason: 'conflict', kind: conflict, ...withBecause }).why;
  }
  const cancelled = Option.getOrUndefined(decodeCancelledKind(kind));
  if (cancelled !== undefined) {
    return explanationOf({ reason: 'cancelled', kind: cancelled }).why;
  }
  const unanswered = Option.getOrUndefined(decodeUnansweredKind(kind));
  return unanswered === undefined ? '' : explanationOf({ reason: 'unanswered', kind: unanswered }).why;
}

function saidOf(receipt: InputReceipt): string {
  if (receipt.kind === 'call_answered') {
    return receipt.rejection === undefined ? '' : whyNot(receipt.rejection);
  }
  return receipt.kind === 'cancel_requested' && receipt.cancel !== undefined
    ? whyNot({ kind: receipt.cancel.kind })
    : '';
}

function why(receipt: InputReceipt): string {
  const said = saidOf(receipt);
  return said === '' ? '' : ` ${asSentence(capitalized(said))}`;
}

export function summaryOf({ receipt, steps, outputs }: RunLogEvent): string {
  const moved = steps.length === 0 ? '' : `, and ${counted(steps.length, step)} moved`;
  const ended = outputs.some(({ kind }) => kind === 'settle') ? '; the workflow ended' : '';
  return `${happened(receipt)}${moved}${ended}.${why(receipt)}`;
}

const notLettersOrDigits = /[^\p{L}\p{N}]+/gu;

const waits: Readonly<Record<NonNullable<Step['waits_for']>, string>> = {
  call: 'waits for a function it called',
  timer: 'waits for its time',
  event: 'waits for an event',
  admission: 'waits for credits or a license',
};

const awaited: ReadonlyMap<string, string> = new Map([
  ['credits_exhausted', 'waits for credits'],
  ['license_required', 'waits for a license key'],
  ['license_invalid', 'waits for its license to be fixed'],
  ['meter_unavailable', 'waits until its credits can be checked'],
]);

const fixedAt: ReadonlyMap<string, (page: string) => string> = new Map([
  ['credits_exhausted', (page: string) => `Credits can be added at ${page}.`],
  ['license_required', (page: string) => `A free license key is available at ${page}.`],
  ['license_invalid', (page: string) => `The license can be fixed at ${page}.`],
]);

type StepRefusal = NonNullable<Step['refusal']>;

function whyInWords(refusal: StepRefusal): string {
  const said = whyNot(refusal);
  return said === '' ? '' : ` ${asSentence(capitalized(said))}`;
}

function whereToFixIt({ kind, resolve_at: resolveAt }: StepRefusal): string {
  if (resolveAt === undefined) {
    return '';
  }
  const fixed = fixedAt.get(kind ?? '') ?? ((page: string) => `It can be fixed at ${page}.`);
  return ` ${fixed(resolveAt)}`;
}

function timeOf(instant: number): string {
  const moment = new Date(instant).toISOString();
  return `${moment.slice(11, 19)} UTC on ${moment.slice(0, 10)}`;
}

function waitingInWords(refusal: StepRefusal): string {
  const waiting = awaited.get(refusal.kind ?? '') ?? waits.admission;
  const tries = ` It tries again at ${timeOf(refusal.retry_at)} and stops waiting at ${timeOf(refusal.until)}.`;
  return `${waiting}.${whyInWords(refusal)}${tries}${whereToFixIt(refusal)}`;
}

const outcomes: Readonly<Record<Exclude<Step['outcome'], 'waiting'>, string>> = {
  started: 'started',
  skipped: 'was skipped',
  completed: 'finished',
  raised: 'failed',
  timed_out: 'took too long, so it was stopped',
  cancelled: 'was cancelled',
};

function movedInWords({ outcome, waits_for: waitsFor }: Step): string {
  return outcome === 'waiting' ? waits[waitsFor ?? 'event'] : outcomes[outcome];
}

export function stepSummaryOf(entry: Step): string {
  const name = entry.name.replaceAll(notLettersOrDigits, ' ').trim();
  const which = name === '' ? 'A step' : `The step ${quoted(name)}`;
  return entry.refusal === undefined ? `${which} ${movedInWords(entry)}.` : `${which} ${waitingInWords(entry.refusal)}`;
}
