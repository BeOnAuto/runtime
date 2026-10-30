import type { Variables } from '../dsl/evaluation.ts';
import type { Json, JsonObject } from '../dsl/json.ts';
import type { TaskEntry } from '../dsl/tasks.ts';
import type { ValueId, Variables as Scope } from '../machine/run-state.ts';
import { dateTimeOf } from '../machine/utc-time.ts';
import type { FramePrefix } from './advance.ts';
import type { Session } from './session.ts';

export function scopeValuesOf(session: Session, scope: Scope): Variables {
  return Object.fromEntries(
    Object.entries(scope).map(([name, id]: readonly [string, ValueId]) => [name, session.valueOf(id)]),
  );
}

export function descriptorOf(session: Session, frame: FramePrefix, entry: TaskEntry): JsonObject {
  return {
    name: entry.name,
    reference: entry.reference,
    definition: entry.task,
    input: session.valueOf(frame.rawInput),
    startedAt: dateTimeOf(frame.startedAt),
  };
}

export function taskVariablesOf(session: Session, frame: FramePrefix, entry: TaskEntry): Variables {
  return {
    ...scopeValuesOf(session, frame.variables),
    context: session.valueOf(frame.context),
    workflow: session.workflow(),
    runtime: session.options.runtime,
    task: descriptorOf(session, frame, entry),
  };
}

export function withInput(variables: Variables, input: Json): Variables {
  return { ...variables, input };
}
