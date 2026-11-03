import { cancelledAsAsked, type CancelledRun, type Finished, type Settlement } from '@on.auto/definitions';
import type { ConflictKind, UnavailableKind } from '@on.auto/operations';
import { counted } from '@on.auto/phrasing';
import type { Schema } from 'effect';

import { spentOf } from '../run/made-by.ts';
import { generationWaitOf } from './generation-wait.ts';
import { settled, type Waiting, type WaitingParts, type WaitingPlace } from './waiting-parts.ts';

interface Told<Kind extends string> {
  readonly detail: string;
  readonly kind?: Kind;
  readonly record?: Schema.JsonObject;
}

function kindOf<Kind extends string>({ kind }: Told<Kind>): { readonly kind?: Kind } {
  return kind === undefined ? {} : { kind };
}

function toldOf(refusal: Told<string>, spent: Schema.JsonObject) {
  return { detail: refusal.detail, record: refusal.record ?? spent };
}

export function refusalsSettled(parts: WaitingParts, waiting: Waiting) {
  const spent = spentOf(waiting.madeBy);
  return {
    conflict: (refusal: Told<ConflictKind>) =>
      settled(parts, waiting, {
        status: 'rejected',
        reason: 'conflict',
        ...toldOf(refusal, spent),
        ...kindOf(refusal),
      }),
    unavailable: (refusal: Told<UnavailableKind>) =>
      settled(parts, waiting, {
        status: 'rejected',
        reason: 'unavailable',
        ...toldOf(refusal, spent),
        ...kindOf(refusal),
      }),
  };
}

const secondsInAMinute = 60;

function waitInWords(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  return seconds % secondsInAMinute === 0
    ? counted(seconds / secondsInAMinute, { one: 'minute', other: 'minutes' })
    : counted(seconds, { one: 'second', other: 'seconds' });
}

export function timedOut({ row }: WaitingPlace, waiting: Waiting): Settlement {
  return {
    status: 'rejected',
    reason: 'unavailable',
    kind: 'generation_timed_out',
    detail: `The provider behind the gateway ${row.gateway} had not made the ${waiting.madeBy.kind} when the run had waited ${waitInWords(row.waits_until - row.deferred_at)} for it, as long as a run waits; a new run asks for it again`,
    record: spentOf(waiting.madeBy),
  };
}

export function cancelledWaiting(run: CancelledRun): Settlement {
  const wait = generationWaitOf(run.record);
  return wait === undefined
    ? cancelledAsAsked(run)
    : { status: 'rejected', reason: 'cancelled', kind: run.kind, detail: run.reason, record: spentOf(wait) };
}

export function succeededWith({ output, record }: Finished): Settlement {
  return { status: 'succeeded', output, record };
}
