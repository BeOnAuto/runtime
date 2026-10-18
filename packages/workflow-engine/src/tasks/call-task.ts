import { invalidArguments, type CallResult } from '@on.auto/operations';

import type { CancelReason } from '../dispatch/run-output.ts';
import { evaluateTemplate } from '../dsl/evaluation.ts';
import { field, jsonBytesOf } from '../dsl/json.ts';
import { callErrorOf, capitalized, errorType, raised, type CallSite } from '../dsl/raised-error.ts';
import { callKeyText } from '../executor/call-key.ts';
import type { DslError } from '../machine/dsl-error.ts';
import { mostCallArgumentsBytes } from '../machine/limits.ts';
import type { FrameBody } from '../machine/run-state.ts';
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
  session.beforeWaiting();
  const key = { runId: session.runId(), reference: entry.reference, run: frame.run };
  const deadline = session.calls.startCall({ key, function: name, arguments: given });
  const { reference } = entry;
  const child = session.options.functions.childOf?.({
    function: name,
    reference,
    run: frame.run,
    arguments: given,
    attributes: session.attributes(),
  });
  session.record({
    reference,
    run: frame.run,
    outcome: 'waiting',
    waitsFor: 'call',
    ...(child === undefined ? {} : { child }),
  });
  const label = session.options.functions.describe(name, given);
  return waitingOn({ kind: 'call', key, function: name, arguments: session.hold(given), label, deadline });
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

function answered({ machine }: Invocation, body: CallBody, result: CallResult): BodyAdvance {
  machine.session.calls.answerCall(body);
  return result.status === 'succeeded'
    ? doneOf(machine.session.hold(result.output))
    : raisedOf(errorOf(machine, result, body));
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

function resumed({ machine }: Invocation, { key }: CallBody): void {
  machine.session.resumedFrom({ reference: key.reference, run: key.run, times: 1 });
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
