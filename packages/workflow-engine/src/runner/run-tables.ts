import { Data } from 'effect';

import type { PerformedOutput } from '../dispatch/run-output.ts';
import { jsonBytesOf, type Json } from '../dsl/json.ts';
import { heldJsonOf, type HeldContents } from '../machine/held-contents.ts';
import type { HeldValue } from '../machine/held-value.ts';
import { heldIn } from '../machine/held-values.ts';
import { mostExpressionWork, mostTasksPerInput, mostWorkPerInput } from '../machine/limits.ts';
import type { MachineState, ValueId } from '../machine/run-state.ts';

export interface Meter {
  readonly allowance: () => number;
  readonly record: (work: number) => void;
  readonly shouldYield: () => boolean;
  readonly countTask: () => void;
}

export interface Journal {
  readonly emit: (output: PerformedOutput) => void;
  readonly outputs: () => readonly PerformedOutput[];
}

export class HeldContentLost extends Data.TaggedError('held_content_lost')<{ readonly value: ValueId }> {}

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
  const outputs: PerformedOutput[] = [];
  return {
    emit: (output) => {
      outputs.push(output);
    },
    outputs: () => outputs,
  };
}

function keptValuesReadOf(values: Readonly<Record<string, HeldValue>>, contents: HeldContents): (id: ValueId) => Json {
  const read = new Map<ValueId, Json>();
  return (id) => {
    const seen = read.get(id);
    if (seen !== undefined) {
      return seen;
    }
    const held = heldIn(values, id);
    const json = heldJsonOf(held, contents);
    if (json === undefined) {
      throw new HeldContentLost({ value: id });
    }
    read.set(id, json);
    return json;
  };
}

export function valueTableOf(machine: MachineState, contents: HeldContents): ValueTable {
  const values: Record<string, HeldValue> = { ...machine.values };
  const counter = { next: machine.nextValue };
  const known = new Map<object, ValueId>();
  const valueOf = keptValuesReadOf(values, contents);
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
    valueOf,
    values: () => values,
    nextValue: () => counter.next,
  };
}
