import { callKeyText } from '../executor/call-key.ts';
import type { RunInput } from '../machine/run-input.ts';
import type { Machine } from '../runner/advance.ts';
import { listenFrameAt } from '../runner/frame-search.ts';
import type { OfferVerdict } from '../runner/run-inbox.ts';
import { verdictOnOffer } from '../tasks/listen-task.ts';
import { resumeRun, startRun } from './run-lifecycle.ts';

function fired(machine: Machine, timerId: string): void {
  for (const timer of machine.session.timers.fire(timerId)) {
    if (timer.purpose === 'deadline') {
      machine.session.end({ kind: 'overran', milliseconds: timer.dueAt - timer.armedAt });
    } else {
      resumeRun(machine, { kind: 'timer', timerId, timer });
    }
  }
}

function received(machine: Machine, input: Extract<RunInput, { readonly kind: 'event_received' }>): void {
  const overflow = machine.session.receiveEvent(input.event);
  if (overflow === undefined) {
    resumeRun(machine, { kind: 'events' });
  } else {
    machine.session.end({ kind: 'raised', error: overflow });
  }
}

const notListening: OfferVerdict = { kind: 'declined' };

function offered(machine: Machine, input: Extract<RunInput, { readonly kind: 'event_offered' }>): void {
  const { session } = machine;
  const frame = listenFrameAt(session.root(), input.listener.reference, input.listener.run);
  const verdict = frame === undefined ? notListening : verdictOnOffer(machine, frame, input.event);
  session.decideOffer(verdict);
  if (verdict.kind !== 'accepted') {
    return;
  }
  const overflow = session.receiveOffer(input.key, input.event);
  if (overflow === undefined) {
    resumeRun(machine, {
      kind: 'offer',
      listener: callKeyText(input.listener),
      slot: verdict.slot,
      event: input.event,
    });
  } else {
    session.end({ kind: 'raised', error: overflow });
  }
}

export function applied(machine: Machine, input: RunInput): void {
  if (input.kind === 'started') {
    startRun(machine, input);
  } else if (input.kind === 'timer_fired') {
    fired(machine, input.timerId);
  } else if (input.kind === 'call_answered') {
    resumeRun(machine, { kind: 'answer', key: callKeyText(input.key), result: input.result });
  } else if (input.kind === 'event_received') {
    received(machine, input);
  } else if (input.kind === 'event_offered') {
    offered(machine, input);
  } else {
    machine.session.requestCancel();
    machine.session.end({ kind: 'cancelled', cancel: input.cancel });
  }
}
