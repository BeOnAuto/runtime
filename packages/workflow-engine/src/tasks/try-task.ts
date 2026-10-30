import type { CancelReason } from '../dispatch/run-output.ts';
import type { Variables } from '../dsl/evaluation.ts';
import { field, objectField, textField, type JsonObject } from '../dsl/json.ts';
import { errorAsJson } from '../dsl/raised-error.ts';
import { attemptDuration, retryDelay, retryPolicyOf, type RetryContext, type RetryState } from '../dsl/retry-policy.ts';
import { catches, timedOut } from '../dsl/task-outcomes.ts';
import type { DslError } from '../machine/dsl-error.ts';
import type { FrameBody } from '../machine/run-state.ts';
import {
  doneOf,
  listBodyOf,
  raisedOf,
  waitingOn,
  type BodyAdvance,
  type Invocation,
  type ListAdvance,
  type Machine,
  type Signal,
} from '../runner/advance.ts';
import type { StepCause } from '../steps/step-entry.ts';

type TryBody = Extract<FrameBody, { readonly kind: 'try' }>;

function handlerOf(invocation: Invocation): JsonObject {
  return objectField(invocation.entry.task, 'catch') ?? {};
}

function retryContextOf(invocation: Invocation, variables: Variables): RetryContext {
  const { session } = invocation.machine;
  return {
    draw: session.random,
    data: invocation.input,
    variables,
    place: session.placeAt(invocation.entry.reference),
  };
}

function policyOf(invocation: Invocation): JsonObject | undefined {
  return retryPolicyOf(
    field(handlerOf(invocation), 'retry'),
    invocation.machine.session.components().retries,
    invocation.entry.reference,
  );
}

function afterAttempt(
  invocation: Invocation,
  retry: RetryState,
  advance: ListAdvance,
  attemptLimit: string | null,
): BodyAdvance {
  if (advance.kind === 'waiting') {
    return waitingOn({ kind: 'try', ...retry, phase: { kind: 'trying', list: advance.cursor, attemptLimit } });
  }
  invocation.machine.session.timers.disarm(attemptLimit);
  return advance.kind === 'raised' ? handled(invocation, retry, advance.error) : listBodyOf(advance);
}

function attempted(invocation: Invocation, retry: RetryState): BodyAdvance {
  const { machine, entry, frame } = invocation;
  const milliseconds = attemptDuration(policyOf(invocation), retryContextOf(invocation, invocation.variables));
  const attemptLimit =
    milliseconds === undefined
      ? null
      : machine.session.timers.arm({
          purpose: 'attempt_limit',
          reference: entry.reference,
          milliseconds,
          label: `${entry.reference} timeout`,
        });
  const advance = machine.runner.startList(machine, {
    pointer: `${entry.reference}/try`,
    data: frame.input,
    variables: frame.variables,
  });
  return afterAttempt(invocation, retry, advance, attemptLimit);
}

function recovered(invocation: Invocation, retry: RetryState, error: DslError): BodyAdvance {
  const { machine, entry, frame } = invocation;
  const errorName = textField(handlerOf(invocation), 'as') ?? 'error';
  const recovery = field(handlerOf(invocation), 'do');
  if (recovery === undefined) {
    return doneOf(frame.input);
  }
  const caught = machine.session.hold(errorAsJson(error));
  const advance = machine.runner.startList(machine, {
    pointer: `${entry.reference}/catch/do`,
    data: frame.input,
    variables: { ...frame.variables, [errorName]: caught },
  });
  return recovering(retry, advance);
}

function recovering(retry: RetryState, advance: ListAdvance): BodyAdvance {
  return advance.kind === 'waiting'
    ? waitingOn({ kind: 'try', ...retry, phase: { kind: 'recovering', list: advance.cursor } })
    : listBodyOf(advance);
}

function handled(invocation: Invocation, retry: RetryState, error: DslError): BodyAdvance {
  const errorName = textField(handlerOf(invocation), 'as') ?? 'error';
  const errorVariables = { ...invocation.variables, [errorName]: errorAsJson(error) };
  const place = invocation.machine.session.placeAt(invocation.entry.reference);
  if (!catches(handlerOf(invocation), error, { data: invocation.input, variables: errorVariables, place })) {
    return raisedOf(error);
  }
  const policy = policyOf(invocation);
  const delay =
    policy === undefined ? undefined : retryDelay(policy, retry, retryContextOf(invocation, errorVariables));
  if (delay === undefined) {
    return recovered(invocation, retry, error);
  }
  const { session } = invocation.machine;
  const { reference } = invocation.entry;
  session.beforeWaiting();
  const timer = session.timers.arm({
    purpose: 'retry_delay',
    reference,
    milliseconds: delay,
    label: `${reference} retry ${retry.attempt + 1}`,
  });
  return waitingOn({ kind: 'try', ...retry, phase: { kind: 'backing_off', timer, error, failed: session.cause() } });
}

export function startTry(invocation: Invocation): BodyAdvance {
  return attempted(invocation, { attempt: 0, startedAt: invocation.machine.session.now });
}

type Trying = Extract<TryBody['phase'], { readonly kind: 'trying' }>;

function retried(invocation: Invocation, body: TryBody, failed: StepCause): BodyAdvance {
  invocation.machine.session.causedBy(failed);
  return attempted(invocation, { attempt: body.attempt + 1, startedAt: body.startedAt });
}

function resumeTrying(invocation: Invocation, body: TryBody, trying: Trying, signal: Signal): BodyAdvance | undefined {
  const { list, attemptLimit } = trying;
  const { machine } = invocation;
  const retry = { attempt: body.attempt, startedAt: body.startedAt };
  if (signal.kind === 'timer' && signal.timerId === attemptLimit) {
    machine.runner.cancelList(machine, list, 'deadline');
    const milliseconds = signal.timer.dueAt - signal.timer.armedAt;
    return handled(invocation, retry, timedOut(milliseconds, invocation.entry.reference).error);
  }
  const advance = machine.runner.resumeList(machine, list, signal);
  return advance === undefined ? undefined : afterAttempt(invocation, retry, advance, attemptLimit);
}

export function resumeTry(invocation: Invocation, body: TryBody, signal: Signal): BodyAdvance | undefined {
  const { machine } = invocation;
  const { phase } = body;
  if (phase.kind === 'trying') {
    return resumeTrying(invocation, body, phase, signal);
  }
  if (phase.kind === 'backing_off') {
    return signal.kind === 'timer' && signal.timerId === phase.timer
      ? retried(invocation, body, phase.failed)
      : undefined;
  }
  const advance = machine.runner.resumeList(machine, phase.list, signal);
  return advance === undefined ? undefined : recovering({ attempt: body.attempt, startedAt: body.startedAt }, advance);
}

export function cancelTry(machine: Machine, { phase }: TryBody, reason: CancelReason): void {
  if (phase.kind === 'backing_off') {
    machine.session.timers.disarm(phase.timer);
    return;
  }
  if (phase.kind === 'trying') {
    machine.session.timers.disarm(phase.attemptLimit);
  }
  machine.runner.cancelList(machine, phase.list, reason);
}
