import { sha256Of, type Digested } from '@on.auto/content';
import { jsonPayloadText, type PayloadToKeep } from '@on.auto/operations/payloads';

import type { PerformedOutput, RunOutput, StartCall } from '../dispatch/run-output.ts';
import { jsonBytesOf, type Json } from '../dsl/json.ts';
import { isKept } from '../machine/held-contents.ts';
import type { HeldValue } from '../machine/held-value.ts';
import type { RunState } from '../machine/run-state.ts';

export interface Keeping {
  readonly state: RunState;
  readonly outputs: readonly RunOutput[];
  readonly kept: readonly Digested[];
  readonly payloads: readonly PayloadToKeep[];
}

interface Decided {
  readonly outputs: readonly PerformedOutput[];
  readonly payloadOffloading: boolean;
  readonly payloadSizeThreshold: number;
}

interface PayloadTable {
  readonly keep: (value: Json, bytes: number) => Digested;
  readonly hold: (value: Json, bytes: number) => Digested;
  readonly held: () => readonly Digested[];
  readonly texts: () => readonly PayloadToKeep[];
}

function payloadTable(): PayloadTable {
  const held = new Map<string, Digested>();
  const texts = new Map<string, PayloadToKeep>();
  const byValue = new Map<Json, Digested>();
  const keep = (value: Json, bytes: number): Digested => {
    const known = byValue.get(value);
    if (known !== undefined) {
      return known;
    }
    const { text, mediaType } = jsonPayloadText(value);
    const kept = { sha256: sha256Of(text), bytes };
    texts.set(kept.sha256, { ...kept, text, mediaType });
    byValue.set(value, kept);
    return kept;
  };
  return {
    keep,
    hold: (value, bytes) => {
      const kept = keep(value, bytes);
      held.set(kept.sha256, kept);
      return kept;
    },
    held: () => [...held.values()],
    texts: () => [...texts.values()],
  };
}

interface Kept {
  readonly table: PayloadTable;
  readonly threshold: number;
}

function heldAfter({ table, threshold }: Kept, before: RunState, [id, held]: readonly [string, HeldValue]): HeldValue {
  const isNew = !Object.hasOwn(before.machine.values, id);
  return isKept(held) || !isNew || held.bytes <= threshold ? held : table.hold(held.value, held.bytes);
}

function startedWith({ table, threshold }: Kept, call: StartCall): RunOutput {
  const { arguments: given, ...started } = call;
  const bytes = jsonBytesOf(given);
  if (bytes <= threshold) {
    return call;
  }
  const { sha256 } = table.keep(given, bytes);
  return { ...started, arguments_sha256: sha256, arguments_bytes: bytes };
}

function keptBefore(before: RunState): ReadonlySet<string> {
  return new Set(Object.values(before.machine.values).flatMap((held) => (isKept(held) ? [held.sha256] : [])));
}

export function keepingOf(
  before: RunState,
  after: RunState,
  { outputs, payloadOffloading, payloadSizeThreshold }: Decided,
): Keeping {
  if (!payloadOffloading) {
    return { state: after, outputs, kept: [], payloads: [] };
  }
  const table = payloadTable();
  const keeping: Kept = { table, threshold: payloadSizeThreshold };
  const values = Object.fromEntries(
    Object.entries(after.machine.values).map((entry: readonly [string, HeldValue]) => [
      entry[0],
      heldAfter(keeping, before, entry),
    ]),
  );
  const recorded = outputs.map((output) => (output.kind === 'start_call' ? startedWith(keeping, output) : output));
  const held = keptBefore(before);
  return {
    state: { ...after, machine: { ...after.machine, values } },
    outputs: recorded,
    kept: table.held(),
    payloads: table.texts().filter(({ sha256 }) => !held.has(sha256)),
  };
}
