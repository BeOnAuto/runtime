import type { RunOutput } from '../dispatch/run-output.ts';
import { jsonBytesOf, type Json } from '../dsl/json.ts';
import { heldIn } from '../machine/held-values.ts';
import { mostExpressionWork, mostTasksPerInput, mostWorkPerInput } from '../machine/limits.ts';
import type { HeldValue, MachineState, ValueId } from '../machine/run-state.ts';

export interface Meter {
  readonly allowance: () => number;
  readonly record: (work: number) => void;
  readonly shouldYield: () => boolean;
  readonly countTask: () => void;
}

export interface Journal {
  readonly emit: (output: RunOutput) => void;
  readonly outputs: () => readonly RunOutput[];
}

export interface ValueTable {
  readonly hold: (value: Json) => ValueId;
  readonly valueOf: (id: ValueId) => Json;
  readonly values: () => Readonly<Record<string, HeldValue>>;
  readonly nextValue: () => ValueId;
}

export function meterOf(): Meter {
  const used = { work: 0, tasks: 0 };
  return {
    allowance: () => Math.min(mostExpressionWork, mostWorkPerInput - used.work),
    record: (work) => {
      used.work += work;
    },
    shouldYield: () => used.work >= mostExpressionWork || used.tasks >= mostTasksPerInput,
    countTask: () => {
      used.tasks += 1;
    },
  };
}

export function journalOf(): Journal {
  const outputs: RunOutput[] = [];
  return {
    emit: (output) => {
      outputs.push(output);
    },
    outputs: () => outputs,
  };
}

export function valueTableOf(machine: MachineState): ValueTable {
  const values: Record<string, HeldValue> = { ...machine.values };
  const counter = { next: machine.nextValue };
  const known = new Map<object, ValueId>();
  return {
    hold: (value) => {
      const seen = typeof value === 'object' && value !== null ? known.get(value) : undefined;
      if (seen !== undefined) {
        return seen;
      }
      const id = counter.next;
      counter.next += 1;
      values[id] = { value, bytes: jsonBytesOf(value) };
      if (typeof value === 'object' && value !== null) {
        known.set(value, id);
      }
      return id;
    },
    valueOf: (id) => heldIn(values, id).value,
    values: () => values,
    nextValue: () => counter.next,
  };
}
