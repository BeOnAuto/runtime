import { admitted, transform } from '../dsl/evaluation.ts';
import { field, objectField } from '../dsl/json.ts';
import { policyOf } from '../dsl/policy.ts';
import { RaisedError, caughtRaise, errorType, outcomeOfOutput, unworkableOutputOf } from '../dsl/raised-error.ts';
import { timedOut, timeoutMilliseconds } from '../dsl/task-outcomes.ts';
import type { Started } from '../machine/run-input.ts';
import type { FrameBody } from '../machine/run-state.ts';
import {
  listBodyOf,
  type BodyAdvance,
  type FramePrefix,
  type Invocation,
  type Machine,
  type Signal,
} from '../runner/advance.ts';
import { cancelBody, resumeBody } from '../tasks/task-bodies.ts';

const root = '/';

function endingOnRaise(machine: Machine, attempt: () => void): void {
  caughtRaise(attempt, (error) => {
    machine.session.end({ kind: 'raised', error });
  });
}

function rootVariables(machine: Machine): Readonly<Record<string, ReturnType<Machine['session']['workflow']>>> {
  return { workflow: machine.session.workflow(), runtime: machine.session.options.runtime };
}

function completed(machine: Machine, output: number): void {
  const { session } = machine;
  const variables = { ...rootVariables(machine), context: session.valueOf(session.context()) };
  const shaped = admitted(
    transform(
      field(objectField(session.document(), 'output') ?? {}, 'as'),
      session.valueOf(output),
      variables,
      session.placeAt(root),
    ),
    root,
  );
  const refusal = session.options.functions.outputRefusal?.(session.document(), shaped);
  session.end(
    refusal === undefined ? outcomeOfOutput(shaped) : { kind: 'raised', error: unworkableOutputOf(refusal, root) },
  );
}

function settledRoot(machine: Machine, frame: FramePrefix, advance: BodyAdvance): void {
  const { session } = machine;
  if (advance.kind === 'waiting') {
    session.setRoot({ ...frame, body: advance.body });
    return;
  }
  session.timers.disarm(frame.timeout);
  if (advance.kind === 'raised') {
    session.end({ kind: 'raised', error: advance.error });
    return;
  }
  completed(machine, advance.output);
}

function refusedByPolicy(machine: Machine): RaisedError | undefined {
  const rejections = policyOf(machine.session.options.functions)(machine.session.document()).filter(
    ({ forbidden }) => forbidden,
  );
  return rejections.length === 0
    ? undefined
    : new RaisedError({
        type: errorType('configuration'),
        status: 400,
        title: 'The workflow document is not allowed by this runtime',
        detail: rejections.map(({ pointer, detail }) => `${pointer}: ${detail}`).join('; '),
        instance: root,
      });
}

function startRoot(machine: Machine, inputId: number): void {
  const { session } = machine;
  const refusal = refusedByPolicy(machine);
  if (refusal !== undefined) {
    throw refusal;
  }
  const document = session.document();
  const input = admitted(session.valueOf(inputId), root);
  const variables = rootVariables(machine);
  const place = session.placeAt(root);
  const transformed = transform(field(objectField(document, 'input') ?? {}, 'from'), input, variables, place);
  const milliseconds = timeoutMilliseconds(field(document, 'timeout'), session.components().timeouts, {
    data: transformed,
    variables,
    place,
  });
  const timeout =
    milliseconds === undefined
      ? null
      : session.timers.arm({ purpose: 'timeout', reference: root, milliseconds, label: `${root} timeout` });
  const data = transformed === input ? inputId : session.hold(transformed);
  const frame: FramePrefix = {
    reference: root,
    run: 1,
    startedAt: session.now,
    context: session.context(),
    rawInput: inputId,
    input: data,
    variables: {},
    timeout,
  };
  settledRoot(machine, frame, listBodyOf(machine.runner.startList(machine, { pointer: '/do', data, variables: {} })));
}

export function startRun(machine: Machine, started: Started): void {
  const { session } = machine;
  const input = session.hold(started.input);
  session.begin({
    runId: started.runId,
    document: started.document,
    input,
    limits: started.limits,
    attributes: started.attributes,
    seed: started.seed,
  });
  session.timers.arm({
    purpose: 'deadline',
    reference: root,
    milliseconds: started.limits.mostDurationMs,
    label: 'the most the workflow may run',
  });
  endingOnRaise(machine, () => {
    startRoot(machine, input);
  });
}

function rootInvocation(machine: Machine, frame: FramePrefix): Invocation {
  return {
    machine,
    frame,
    entry: { name: '', task: {}, reference: root },
    kind: 'do',
    configuration: null,
    input: null,
    variables: {},
  };
}

function resumeRoot(machine: Machine, frame: FramePrefix & { readonly body: FrameBody }, signal: Signal): void {
  const { session } = machine;
  if (signal.kind === 'timer' && signal.timerId === frame.timeout) {
    cancelBody(machine, frame, 'deadline');
    session.end({ kind: 'raised', error: timedOut(signal.timer.dueAt - signal.timer.armedAt, root).error });
    return;
  }
  const advance = resumeBody(rootInvocation(machine, frame), frame.body, signal);
  if (advance !== undefined) {
    settledRoot(machine, frame, advance);
  }
}

export function resumeRun(machine: Machine, signal: Signal): void {
  const frame = machine.session.root();
  if (frame !== null) {
    endingOnRaise(machine, () => {
      resumeRoot(machine, frame, signal);
    });
  }
}
