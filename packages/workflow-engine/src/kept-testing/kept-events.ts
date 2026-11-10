import { valueAtPointer, type Json } from '../dsl/json.ts';
import { isKept } from '../machine/held-contents.ts';
import type { RunState } from '../machine/run-state.ts';
import { stateFormats } from '../run-log/known-formats.ts';
import type { PositionedEvent, RunLogEvent } from '../run-log/run-event.ts';
import { stateFormat, type OlderFormat } from '../run-log/state-format.ts';
import type { MemoryDriver } from '../testing/memory-driver.ts';

export const formatEleven: OlderFormat | undefined = stateFormats.older.find(({ format }) => format === stateFormat);

function keptIn(event: RunLogEvent): readonly string[] | undefined {
  return 'kept' in event ? event.kept.map(({ sha256 }) => sha256) : undefined;
}

export function keptAlong(events: readonly PositionedEvent[]): readonly (readonly string[] | undefined)[] {
  return events.map(({ event }) => keptIn(event));
}

function keptDigestOf(value: Json): readonly string[] {
  const sha256 = valueAtPointer(value, '/sha256');
  return typeof sha256 === 'string' ? [sha256] : [];
}

export function digestsAddedIn(event: RunLogEvent): readonly string[] {
  return event.patch.flatMap((operation) =>
    operation.op === 'add' && operation.path.startsWith('/machine/values/') ? keptDigestOf(operation.value) : [],
  );
}

export function addsAKeptValue(event: RunLogEvent): boolean {
  return digestsAddedIn(event).length > 0;
}

export function keptValuesIn(state: RunState): readonly string[] {
  return Object.values(state.machine.values).flatMap((held) => (isKept(held) ? [held.sha256] : []));
}

export function argumentsPerformedBy(driver: MemoryDriver): readonly unknown[] {
  return driver.ports.faults
    .dispatched()
    .flatMap(({ output }) => (output.kind === 'start_call' ? [output.arguments] : []));
}
