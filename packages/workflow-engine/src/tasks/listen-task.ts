import { evaluate } from '../dsl/evaluation.ts';
import { field, isObject, objectField, textField, type Json, type JsonObject } from '../dsl/json.ts';
import { caughtRaise } from '../dsl/raised-error.ts';
import { eventFiltersOf, type LocatedFilter } from '../dsl/task-policy.ts';
import { callKeyText, type CallKey } from '../executor/call-key.ts';
import { playbookWideFilterOf, hasAttributes } from '../filters/event-filter.ts';
import type { FrameBody, TaskFrame, ValueId } from '../machine/run-state.ts';
import { doneOf, waitingOn, type BodyAdvance, type Invocation, type Machine, type Signal } from '../runner/advance.ts';
import type { ListenFrame } from '../runner/frame-search.ts';
import type { OfferVerdict } from '../runner/run-inbox.ts';

type ListenBody = Extract<FrameBody, { readonly kind: 'listen' }>;

type EventFilter = (event: JsonObject) => boolean;

type Slots = readonly (ValueId | null)[];

interface Listening {
  readonly all: boolean;
  readonly read: string;
  readonly filters: readonly Json[];
}

function listeningOf(invocation: Invocation): Listening {
  const listen = objectField(invocation.entry.task, 'listen') ?? {};
  const to = objectField(listen, 'to') ?? {};
  return {
    all: field(to, 'all') !== undefined,
    read: textField(listen, 'read') ?? 'data',
    filters: eventFiltersOf(to, `${invocation.entry.reference}/listen/to`).map(([filter]: LocatedFilter) => filter),
  };
}

function acceptsBy(filter: Json, invocation: Invocation): EventFilter {
  const properties = isObject(filter) ? (objectField(filter, 'with') ?? {}) : {};
  return (event) =>
    hasAttributes(event, properties, (expression, value) =>
      evaluate(expression, value, {}, invocation.machine.session.placeAt(invocation.entry.reference)),
    );
}

function keyOf(invocation: Invocation): CallKey {
  const { frame, machine } = invocation;
  return { runId: machine.session.runId(), reference: frame.reference, run: frame.run };
}

function slotsOf(listening: Listening, consumed: Slots): Slots {
  return listening.all ? listening.filters.map((_, index) => consumed[index] ?? null) : consumed;
}

function filledOnce(invocation: Invocation, accepts: readonly EventFilter[], slots: Slots): Slots | undefined {
  const { session } = invocation.machine;
  for (const [index, filter] of accepts.entries()) {
    const event = slots[index] === null ? session.takeEvent(filter) : undefined;
    if (event !== undefined) {
      return slots.with(index, session.hold(event));
    }
  }
  return undefined;
}

function takeAll(invocation: Invocation, accepts: readonly EventFilter[], slots: Slots): Slots {
  const filled = filledOnce(invocation, accepts, slots);
  return filled === undefined ? slots : takeAll(invocation, accepts, filled);
}

function taken(invocation: Invocation, consumed: Slots): Slots {
  const listening = listeningOf(invocation);
  const accepts = listening.filters.map((filter) => acceptsBy(filter, invocation));
  if (listening.all) {
    return takeAll(invocation, accepts, slotsOf(listening, consumed));
  }
  const { session } = invocation.machine;
  const event = session.takeEvent((candidate) => accepts.some((accept) => accept(candidate)));
  return event === undefined ? consumed : [session.hold(event)];
}

function isSatisfied(listening: Listening, consumed: Slots): boolean {
  const filled = consumed.filter((slot) => slot !== null).length;
  return listening.all ? filled >= listening.filters.length : filled > 0;
}

function playbookWideFiltersOf(listening: Listening): readonly JsonObject[] {
  return listening.filters.flatMap((filter) => {
    const attributes = playbookWideFilterOf(filter);
    return attributes === undefined ? [] : [attributes];
  });
}

function handedOn(invocation: Invocation, listening: Listening, consumed: Slots): BodyAdvance {
  const { session } = invocation.machine;
  session.listeners.cancel(keyOf(invocation));
  const events = consumed.filter((slot) => slot !== null).map((id) => session.valueOf(id));
  return doneOf(
    session.hold(
      events.map((event) => (listening.read === 'data' && isObject(event) ? (field(event, 'data') ?? null) : event)),
    ),
  );
}

function settled(invocation: Invocation, consumed: Slots, waited: number): BodyAdvance {
  const listening = listeningOf(invocation);
  if (isSatisfied(listening, consumed)) {
    return handedOn(invocation, listening, consumed);
  }
  const { session } = invocation.machine;
  session.beforeWaiting();
  const playbookWide = playbookWideFiltersOf(listening);
  if (playbookWide.length > 0) {
    session.listeners.arm(keyOf(invocation), playbookWide);
  }
  const { reference } = invocation.entry;
  session.record({ reference, run: invocation.frame.run, outcome: 'waiting', waitsFor: 'event', times: waited + 1 });
  return waitingOn({ kind: 'listen', consumed: slotsOf(listening, consumed), waited: waited + 1 });
}

export function startListen(invocation: Invocation): BodyAdvance {
  return settled(invocation, taken(invocation, []), 0);
}

function withOffer(
  invocation: Invocation,
  body: ListenBody,
  signal: Extract<Signal, { readonly kind: 'offer' }>,
): Slots {
  const listening = listeningOf(invocation);
  const held = invocation.machine.session.hold(signal.event);
  return listening.all ? slotsOf(listening, body.consumed).with(signal.slot, held) : [held];
}

function consumedBy(invocation: Invocation, body: ListenBody, signal: Signal): Slots | undefined {
  if (signal.kind === 'events') {
    const consumed = taken(invocation, body.consumed);
    return consumed.filter((slot) => slot !== null).length === body.consumed.filter((slot) => slot !== null).length
      ? undefined
      : consumed;
  }
  return signal.kind === 'offer' && signal.listener === callKeyText(keyOf(invocation))
    ? withOffer(invocation, body, signal)
    : undefined;
}

export function resumeListen(invocation: Invocation, body: ListenBody, signal: Signal): BodyAdvance | undefined {
  const consumed = consumedBy(invocation, body, signal);
  if (consumed === undefined) {
    return undefined;
  }
  const { frame } = invocation;
  invocation.machine.session.resumedFrom({ reference: frame.reference, run: frame.run, times: body.waited });
  return settled(invocation, consumed, body.waited);
}

export function cancelListen(machine: Machine, frame: Pick<TaskFrame, 'reference' | 'run'>): void {
  machine.session.listeners.cancel({
    runId: machine.session.runId(),
    reference: frame.reference,
    run: frame.run,
  });
}

interface OpenSlot {
  readonly index: number;
  readonly filter: Json;
}

function openSlotsOf(listening: Listening, body: ListenBody): readonly OpenSlot[] {
  const slots = slotsOf(listening, body.consumed);
  return listening.filters.flatMap((filter, index) =>
    playbookWideFilterOf(filter) !== undefined && (!listening.all || slots[index] === null) ? [{ index, filter }] : [],
  );
}

function offerVerdictOf(invocation: Invocation, body: ListenBody, event: JsonObject): OfferVerdict {
  const listening = listeningOf(invocation);
  return caughtRaise<OfferVerdict>(
    () => {
      const open = openSlotsOf(listening, body).find(({ filter }) => acceptsBy(filter, invocation)(event));
      return open === undefined ? { kind: 'declined' } : { kind: 'accepted', slot: open.index };
    },
    (error) => ({ kind: 'failed', error }),
  );
}

export function verdictOnOffer(machine: Machine, frame: ListenFrame, event: JsonObject): OfferVerdict {
  return offerVerdictOf(machine.runner.invocationAt(machine, frame), frame.body, event);
}
