import type { CancelReason } from '../dispatch/run-output.ts';
import { evaluateExpression, holds } from '../dsl/evaluation.ts';
import { field, isList, itemAt, objectField, textField, type JsonObject } from '../dsl/json.ts';
import { raised } from '../dsl/raised-error.ts';
import type { FrameBody, ValueId } from '../machine/run-state.ts';
import {
  doneOf,
  listBodyOf,
  type BodyAdvance,
  type Invocation,
  type ListAdvance,
  type ListStart,
  type Machine,
  type Signal,
} from '../runner/advance.ts';
import { scopeValuesOf } from '../runner/task-variables.ts';

type ForBody = Extract<FrameBody, { readonly kind: 'for' }>;

interface Iteration {
  readonly items: ValueId;
  readonly index: number;
  readonly data: ValueId;
}

function loopOf(invocation: Invocation): JsonObject {
  return objectField(invocation.entry.task, 'for') ?? {};
}

interface Next {
  readonly kind: 'next';
  readonly iteration: Iteration;
}

type Turn = Next | BodyAdvance;

function afterBody(iteration: Iteration, advance: ListAdvance): Turn {
  if (advance.kind === 'waiting') {
    return { kind: 'waiting', body: { kind: 'for', ...iteration, list: advance.cursor } };
  }
  if (advance.kind === 'ended' && advance.ending === 'completed') {
    return { kind: 'next', iteration: { ...iteration, index: iteration.index + 1, data: advance.output } };
  }
  return listBodyOf(advance);
}

function bodyStarted(invocation: Invocation, start: ListStart): ListAdvance {
  const { machine, entry } = invocation;
  if (machine.session.meter.shouldYield()) {
    return machine.runner.yieldList(machine, start, entry.reference);
  }
  machine.session.meter.countTask();
  return machine.runner.startList(machine, start);
}

function turnOf(invocation: Invocation, iteration: Iteration): Turn {
  const { machine, entry, frame, variables } = invocation;
  const { session } = machine;
  const item = itemAt(session.valueOf(iteration.items), iteration.index);
  if (item === undefined) {
    return doneOf(iteration.data);
  }
  const loop = loopOf(invocation);
  const scope = {
    ...frame.variables,
    [textField(loop, 'each') ?? 'item']: session.hold(item),
    [textField(loop, 'at') ?? 'index']: session.hold(iteration.index),
  };
  const conditionVariables = {
    ...variables,
    ...scopeValuesOf(session, scope),
    context: session.valueOf(session.context()),
  };
  if (
    !holds(
      field(entry.task, 'while'),
      session.valueOf(iteration.data),
      conditionVariables,
      session.placeAt(entry.reference),
    )
  ) {
    return doneOf(iteration.data);
  }
  const advance = bodyStarted(invocation, { pointer: `${entry.reference}/do`, data: iteration.data, variables: scope });
  return afterBody(iteration, advance);
}

function iterated(invocation: Invocation, first: Iteration): BodyAdvance {
  let turn: Turn = { kind: 'next', iteration: first };
  while (turn.kind === 'next') {
    turn = turnOf(invocation, turn.iteration);
  }
  return turn;
}

export function startFor(invocation: Invocation): BodyAdvance {
  const { machine, entry, input, variables } = invocation;
  const { session } = machine;
  const items = evaluateExpression(
    textField(loopOf(invocation), 'in') ?? 'null',
    input,
    variables,
    session.placeAt(entry.reference),
  );
  if (!isList(items)) {
    throw raised('validation', 400, 'for.in must give an array to iterate over', entry.reference);
  }
  return iterated(invocation, { items: session.hold(items), index: 0, data: invocation.frame.input });
}

export function resumeFor(invocation: Invocation, body: ForBody, signal: Signal): BodyAdvance | undefined {
  const advance = invocation.machine.runner.resumeList(invocation.machine, body.list, signal);
  if (advance === undefined) {
    return undefined;
  }
  const turn = afterBody({ items: body.items, index: body.index, data: body.data }, advance);
  return turn.kind === 'next' ? iterated(invocation, turn.iteration) : turn;
}

export function cancelFor(machine: Machine, body: ForBody, reason: CancelReason): void {
  machine.runner.cancelList(machine, body.list, reason);
}
