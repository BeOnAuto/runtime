import { Data } from 'effect';

import { isKept } from '../machine/held-contents.ts';
import type { HeldValue } from '../machine/held-value.ts';
import type { RunState } from '../machine/run-state.ts';
import { stateFormats } from './known-formats.ts';
import type { RunLogEvent } from './run-event.ts';

export class UnreadableWrite extends Data.TaggedError('unreadable_write')<{ readonly detail: string }> {}

function heldValueKeptIn(state: RunState): string | undefined {
  return Object.entries(state.machine.values).find(([, held]: readonly [string, HeldValue]) => isKept(held))?.[0];
}

export function requireValuesHeldInline(event: RunLogEvent, after: RunState): void {
  const kept = event.format < stateFormats.current ? heldValueKeptIn(after) : undefined;
  if (kept !== undefined) {
    throw new UnreadableWrite({
      detail: `An event of format ${event.format} leaves value ${kept} kept outside, which only format ${stateFormats.current} holds`,
    });
  }
}
