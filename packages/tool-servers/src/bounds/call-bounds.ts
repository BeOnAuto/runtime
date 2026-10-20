import { cutWhereValid } from './structural-cut.ts';
import { bytesOf, canonicalJson, cutAtCodePoint } from './text-bytes.ts';

export const toolBounds = {
  callsInRun: 25,
  argumentBytes: 16_384,
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

export interface CallTally {
  readonly calls: number;
  readonly failures: number;
  readonly sameCalls: ReadonlyMap<string, readonly string[]>;
}

export interface CallAsked {
  readonly tool: string;
  readonly callId: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export type Admission =
  | { readonly admitted: true; readonly tally: CallTally }
  | { readonly admitted: false; readonly tally: CallTally; readonly refusal: string };

export interface ShownResult {
  readonly text: string;
  readonly shownBytes?: number;
}

export const noCalls: CallTally = { calls: 0, failures: 0, sameCalls: new Map() };

const allCallsMade = `This run has made all the ${toolBounds.callsInRun} tool calls it may; answer from what you have.`;

function argumentsTooLarge(bytes: number): string {
  return `The arguments of this call take ${bytes} bytes, more than the ${toolBounds.argumentBytes} a call may send; send less.`;
}

function repeated(earlier: readonly string[]): string {
  return `This call repeats, with the same arguments, a call this run already made ${toolBounds.sameCallsInRun} times; use the answer to the call ${String(earlier.at(-1))} instead.`;
}

function refusalOf(tally: CallTally, argumentBytes: number, earlier: readonly string[]): string | undefined {
  if (tally.calls > toolBounds.callsInRun) {
    return allCallsMade;
  }
  if (argumentBytes > toolBounds.argumentBytes) {
    return argumentsTooLarge(argumentBytes);
  }
  return earlier.length >= toolBounds.sameCallsInRun ? repeated(earlier) : undefined;
}

export function admission(tally: CallTally, { tool, callId, input }: CallAsked): Admission {
  const counted = { ...tally, calls: tally.calls + 1 };
  const key = `${tool}\u0000${canonicalJson(input)}`;
  const earlier = tally.sameCalls.get(key) ?? [];
  const refusal = refusalOf(counted, bytesOf(JSON.stringify(input)), earlier);
  return refusal === undefined
    ? { admitted: true, tally: { ...counted, sameCalls: new Map([...tally.sameCalls, [key, [...earlier, callId]]]) } }
    : { admitted: false, tally: counted, refusal };
}

const measured = new Intl.NumberFormat('en');

function cutNote(shown: number, bytes: number): string {
  return `\n[The answer was cut to ${measured.format(shown)} of its ${measured.format(bytes)} bytes, to fit what the model may still read; ask for fewer rows, fields or depth to see the rest.]`;
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

export function failedOnce(tally: CallTally): CallTally {
  return { ...tally, failures: tally.failures + 1 };
}

export function failuresEnded({ failures }: CallTally): boolean {
  return failures >= toolBounds.failuresInRun;
}

export function callsEnded({ calls }: CallTally): boolean {
  return calls >= toolBounds.callsInRun;
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
