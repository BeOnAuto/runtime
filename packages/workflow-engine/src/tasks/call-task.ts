import { invalidArguments, type CallResult, type RejectedCall } from '@on.auto/operations';

import type { CancelReason } from '../dispatch/run-output.ts';
import { evaluateTemplate } from '../dsl/evaluation.ts';
import { field, jsonBytesOf } from '../dsl/json.ts';
import { callErrorOf, capitalized, errorType, raised, type CallSite } from '../dsl/raised-error.ts';
import { callKeyText } from '../executor/call-key.ts';
import type { DslError } from '../machine/dsl-error.ts';
import {
  firstAdmissionWaitMs,
  longestAdmissionWaitMs,
  mostAdmissionWaitMs,
  mostCallArgumentsBytes,
} from '../machine/limits.ts';
import type { FrameBody, ValueId } from '../machine/run-state.ts';
import {
  doneOf,
  raisedOf,
  waitingOn,
  type BodyAdvance,
  type Invocation,
  type Machine,
  type Signal,
} from '../runner/advance.ts';

type CallBody = Extract<FrameBody, { readonly kind: 'call' }>;

type AdmissionBody = Extract<FrameBody, { readonly kind: 'admission' }>;

interface Called {
  readonly function: string;
  readonly arguments: ValueId;
  readonly label: string;
}

function called(invocation: Invocation, call: Called, run: number, refused?: CallBody['refused']): BodyAdvance {
  const { machine, entry, frame } = invocation;
  const { session } = machine;
  const { reference } = entry;
  const given = session.valueOf(call.arguments);
  session.beforeWaiting();
  const key = { runId: session.runId(), reference, run };
  const deadline = session.calls.startCall({ key, function: call.function, arguments: given });
  const child = session.options.functions.childOf?.({
    function: call.function,
    reference,
    run,
    arguments: given,
    attributes: session.attributes(),
  });
  session.record({
    reference,
    run: frame.run,
    outcome: 'waiting',
    waitsFor: 'call',
    ...(child === undefined ? {} : { child }),
    ...(refused === undefined ? {} : { times: refused.waited }),
  });
  const { function: name, arguments: held, label } = call;
  return waitingOn({
    kind: 'call',
    key,
    function: name,
    arguments: held,
    label,
    deadline,
    ...(refused === undefined ? {} : { refused }),
  });
}

export function startCall(invocation: Invocation): BodyAdvance {
  const { machine, entry, frame, configuration, input, variables } = invocation;
  const { session } = machine;
  if (typeof configuration !== 'string' || configuration === '') {
    throw raised('configuration', 400, 'call names no function', entry.reference);
  }
  const name = configuration;
  const given = evaluateTemplate(field(entry.task, 'with') ?? null, input, variables, session.placeAt(entry.reference));
  const bytes = jsonBytesOf(given);
  if (bytes > mostCallArgumentsBytes) {
    throw raised(
      'validation',
      400,
      `The arguments of ${name} take ${bytes} bytes as JSON, more than the ${mostCallArgumentsBytes} a call takes`,
      entry.reference,
    );
  }
  const label = session.options.functions.describe(name, given);
  return called(invocation, { function: name, arguments: session.hold(given), label }, frame.run);
}

type FailedResult = Exclude<CallResult, { readonly status: 'succeeded' }>;

function refusedBy(machine: Machine, body: CallBody, result: FailedResult): Pick<CallSite, 'refused'> {
  const words = machine.session.options.functions.refusal;
  return result.status !== 'rejected' || words === undefined
    ? {}
    : { refused: words(body.function, machine.session.valueOf(body.arguments), result) };
}

function errorOf(machine: Machine, result: FailedResult, body: CallBody): DslError {
  if (result.status === 'rejected' && result.reason === invalidArguments) {
    return { type: errorType('validation'), status: 400, title: result.detail, instance: body.key.reference };
  }
  return callErrorOf(result, {
    function: body.function,
    label: body.label,
    reference: body.key.reference,
    ...refusedBy(machine, body, result),
  });
}

function admissionWaitAfter(refusals: number): number {
  return Math.min(firstAdmissionWaitMs * 2 ** (refusals - 1), longestAdmissionWaitMs);
}

function waitedForAdmission(invocation: Invocation, body: CallBody, refusal: RejectedCall): BodyAdvance | undefined {
  const { machine, entry, frame } = invocation;
  const { session } = machine;
  const since = body.refused?.since ?? session.now;
  const until = since + mostAdmissionWaitMs;
  if (session.now >= until) {
    return undefined;
  }
  const refusals = (body.refused?.refusals ?? 0) + 1;
  const waited = (body.refused?.waited ?? 1) + 1;
  const retryAt = Math.min(session.now + admissionWaitAfter(refusals), until);
  const { reference } = entry;
  session.beforeWaiting();
  const timer = session.timers.arm({
    purpose: 'retry_delay',
    reference,
    milliseconds: retryAt - session.now,
    label: `${reference} admission ${refusals}`,
  });
  session.record({
    reference,
    run: frame.run,
    outcome: 'waiting',
    waitsFor: 'admission',
    times: waited,
    refusal: { ...refusal, retry_at: retryAt, until },
  });
  const { function: name, arguments: given, label } = body;
  return waitingOn({
    kind: 'admission',
    function: name,
    arguments: given,
    label,
    timer,
    refused: { since, refusals, waited },
  });
}

function failedWith(invocation: Invocation, body: CallBody, result: FailedResult): BodyAdvance {
  const waiting =
    result.status === 'rejected' && result.admission === 'refused'
      ? waitedForAdmission(invocation, body, result)
      : undefined;
  return waiting ?? raisedOf(errorOf(invocation.machine, result, body));
}

function answered(invocation: Invocation, body: CallBody, result: CallResult): BodyAdvance {
  const { session } = invocation.machine;
  session.calls.answerCall(body);
  return result.status === 'succeeded' ? doneOf(session.hold(result.output)) : failedWith(invocation, body, result);
}

function timedOutCall({ machine }: Invocation, body: CallBody, milliseconds: number): BodyAdvance {
  machine.session.calls.cancelCall(body, 'deadline');
  return raisedOf({
    type: errorType('timeout'),
    status: 408,
    title: `${capitalized(body.label)} did not finish within ${milliseconds} ms, the most it may take`,
    instance: body.key.reference,
  });
}

function resumed({ machine, frame }: Invocation, { refused }: CallBody): void {
  machine.session.resumedFrom({ reference: frame.reference, run: frame.run, times: refused?.waited ?? 1 });
}

export function resumeCall(invocation: Invocation, body: CallBody, signal: Signal): BodyAdvance | undefined {
  if (signal.kind === 'answer' && signal.key === callKeyText(body.key)) {
    resumed(invocation, body);
    return answered(invocation, body, signal.result);
  }
  if (signal.kind === 'timer' && signal.timerId === body.deadline) {
    resumed(invocation, body);
    return timedOutCall(invocation, body, signal.timer.dueAt - signal.timer.armedAt);
  }
  return undefined;
}

export function cancelCall(machine: Machine, body: CallBody, reason: CancelReason): void {
  machine.session.calls.cancelCall(body, reason);
}

export function resumeAdmission(invocation: Invocation, body: AdmissionBody, signal: Signal): BodyAdvance | undefined {
  if (signal.kind !== 'timer' || signal.timerId !== body.timer) {
    return undefined;
  }
  const { machine, frame, entry } = invocation;
  const { session } = machine;
  const { refused } = body;
  session.resumedFrom({ reference: frame.reference, run: frame.run, times: refused.waited });
  return called(invocation, body, session.nextRun(entry.reference), { ...refused, waited: refused.waited + 1 });
}

export function cancelAdmission(machine: Machine, body: AdmissionBody): void {
  machine.session.timers.disarm(body.timer);
}
