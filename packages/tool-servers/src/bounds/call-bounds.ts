import { sha256Of } from '@on.auto/content';

import type { CallsEndedBecause } from '../access/tool-server-failed.ts';
import { cutWhereValid } from './structural-cut.ts';
import { bytesOf, canonicalJson, cutAtCodePoint } from './text-bytes.ts';

export const toolBounds = {
  actingCallsInRun: 25,
  argumentBytes: 262_144,
  sameCallsInRun: 2,
  failuresInRun: 5,
  longestRetryWaitMs: 10_000,
  callMs: 30_000,
  openMs: 10_000,
  runMs: 600_000,
  descriptionBytes: 4096,
  failureBytes: 1024,
  executedAnswerBytes: 65_536,
  readAnswerBytes: 65_536,
  httpAnswerBytes: 16_777_216,
  stdioOutputBytes: 4_194_304,
} as const;

export interface Timing {
  readonly callMs: number;
  readonly openMs: number;
  readonly longestRetryWaitMs: number;
}

export const defaultTiming: Timing = {
  callMs: toolBounds.callMs,
  openMs: toolBounds.openMs,
  longestRetryWaitMs: toolBounds.longestRetryWaitMs,
};

export interface RequestBounds {
  readonly requestMs: number;
  readonly requestTimeout: (ms: number) => AbortSignal;
}

export function requestBoundsOf(given: Partial<RequestBounds>): RequestBounds {
  return {
    requestMs: given.requestMs ?? toolBounds.callMs,
    requestTimeout: given.requestTimeout ?? ((ms) => AbortSignal.timeout(ms)),
  };
}

export interface CallCount {
  readonly most: number;
  readonly countsReads: boolean;
}

export const actingCallsCount: CallCount = { most: toolBounds.actingCallsInRun, countsReads: false };

export function callCountOf(mostToolCalls?: number): CallCount {
  return mostToolCalls === undefined ? actingCallsCount : { most: mostToolCalls, countsReads: true };
}

export interface CallTally {
  readonly counted: number;
  readonly failures: number;
  readonly sameCalls: ReadonlyMap<string, readonly string[]>;
}

export interface CallAsked {
  readonly tool: string;
  readonly callId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly reads: boolean;
}

export type Admission =
  | { readonly admitted: true; readonly tally: CallTally }
  | { readonly admitted: false; readonly tally: CallTally; readonly refusal: string };

export interface ShownResult {
  readonly text: string;
  readonly shownBytes?: number;
}

export const noCalls: CallTally = { counted: 0, failures: 0, sameCalls: new Map() };

function allCallsMade({ most, countsReads }: CallCount): string {
  return countsReads
    ? `This run has made all the ${most} tool calls it may; answer from what you have.`
    : `This run has made all the ${most} calls it may make of tools that can change things; answer from what you have.`;
}

function argumentsTooLarge(bytes: number): string {
  return `The arguments of this call take ${bytes} bytes, more than the ${toolBounds.argumentBytes} a call may send; send less in one call, in parts where the tool takes them.`;
}

function repeated(earlier: readonly string[]): string {
  return `This call repeats, with the same arguments, a call this run already made ${toolBounds.sameCallsInRun} times; use the answer to the call ${String(earlier.at(-1))} instead.`;
}

function refusalOf(argumentBytes: number, earlier: readonly string[]): string | undefined {
  if (argumentBytes > toolBounds.argumentBytes) {
    return argumentsTooLarge(argumentBytes);
  }
  return earlier.length >= toolBounds.sameCallsInRun ? repeated(earlier) : undefined;
}

function countsAgainst({ countsReads }: CallCount, { reads }: Pick<CallAsked, 'reads'>): boolean {
  return countsReads || !reads;
}

function sameCallKeyOf({ tool, input }: Pick<CallAsked, 'tool' | 'input'>): string {
  return sha256Of(`${tool}\u0000${canonicalJson(input)}`);
}

function sentIn(tally: CallTally, key: string, callId: string): CallTally {
  return { ...tally, sameCalls: new Map([...tally.sameCalls, [key, [...(tally.sameCalls.get(key) ?? []), callId]]]) };
}

export function admission(tally: CallTally, call: CallAsked, count: CallCount): Admission {
  const itCounts = countsAgainst(count, call);
  const pastTheCount = itCounts && tally.counted >= count.most;
  const key = sameCallKeyOf(call);
  const earlier = tally.sameCalls.get(key) ?? [];
  const refusal = pastTheCount ? allCallsMade(count) : refusalOf(bytesOf(JSON.stringify(call.input)), earlier);
  const isCounted = itCounts && (count.countsReads || pastTheCount || refusal === undefined);
  const counted = isCounted ? { ...tally, counted: tally.counted + 1 } : tally;
  return refusal === undefined
    ? { admitted: true, tally: sentIn(counted, key, call.callId) }
    : { admitted: false, tally: counted, refusal };
}

export function countedAsSent(tally: CallTally, call: Pick<CallAsked, 'reads'>, count: CallCount): CallTally {
  return countsAgainst(count, call) ? { ...tally, counted: tally.counted + 1 } : tally;
}

export function admittedAsSent(tally: CallTally, call: CallAsked, count: CallCount): CallTally {
  return sentIn(countedAsSent(tally, call, count), sameCallKeyOf(call), call.callId);
}

export function askedPastTheCount({ counted }: CallTally, { most }: CallCount): boolean {
  return counted > most;
}

const counts = new Intl.NumberFormat('en');

export function measured(count: number): string {
  return counts.format(count);
}

function cutNote(shown: number, bytes: number): string {
  return `\n[The answer was cut to ${measured(shown)} of its ${measured(bytes)} bytes, to fit what the model may still read; ask for fewer rows, fields or depth to see the rest.]`;
}

export function shownResult(text: string, room?: number): ShownResult {
  const bytes = bytesOf(text);
  if (room === undefined || bytes <= room) {
    return { text };
  }
  const shown = cutWhereValid(text, Math.max(0, room - bytesOf(cutNote(room, bytes))));
  const shownBytes = bytesOf(shown);
  return { text: `${shown}${cutNote(shownBytes, bytes)}`, shownBytes };
}

export function shownWithin(text: string, shownBytes: number): string {
  return cutWhereValid(text, shownBytes);
}

export function shownAgain(text: string, shownBytes: number): string {
  return `${shownWithin(text, shownBytes)}${cutNote(shownBytes, bytesOf(text))}`;
}

const failuresOfTheRun: ReadonlySet<string> = new Set(['server_failure', 'timed_out']);

export function countsAgainstTheRun(because: string): boolean {
  return failuresOfTheRun.has(because);
}

export function failingBecause(rateLimited: boolean): CallsEndedBecause {
  return rateLimited ? 'rate_limited' : 'failing';
}

export function failedOnce(tally: CallTally): CallTally {
  return { ...tally, failures: tally.failures + 1 };
}

export function failuresEnded({ failures }: CallTally): boolean {
  return failures >= toolBounds.failuresInRun;
}

export function runBoundMs(stepDeadlineMs: number): number {
  return Math.max(toolBounds.runMs, stepDeadlineMs);
}

export function cutToDescriptionBound(text: string): string {
  return cutAtCodePoint(text, toolBounds.descriptionBytes);
}

export function cutToFailureBound(text: string): string {
  return cutAtCodePoint(text, toolBounds.failureBytes);
}
