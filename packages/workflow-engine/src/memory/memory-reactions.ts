import { Effect } from 'effect';

import type { ArmListener, EmitEvent } from '../dispatch/run-output.ts';
import type { JsonObject } from '../dsl/json.ts';
import { callKeyText } from '../executor/call-key.ts';
import type { Emitter, Listeners } from '../reactions/reaction-ports.ts';
import type { Faults } from './memory-timers.ts';

export interface ArmedListener {
  readonly listener: ArmListener;
  readonly armedBy: number;
}

export interface MemoryListeners extends Listeners {
  readonly armed: () => readonly ArmedListener[];
}

export interface MemoryEmitter extends Emitter {
  readonly emitted: () => readonly JsonObject[];
}

export function memoryListeners(faults: Faults, mostListeners = Number.POSITIVE_INFINITY): MemoryListeners {
  const armed = new Map<string, ArmedListener>();
  return {
    arm: (listener, _run, { version }) =>
      faults.attempt(listener, () => {
        const key = callKeyText(listener.key);
        if (armed.has(key)) {
          return 'already_armed';
        }
        if (armed.size >= mostListeners) {
          return 'refused';
        }
        armed.set(key, { listener, armedBy: version });
        return 'armed';
      }),
    cancel: (listener) =>
      faults.attempt(listener, () => (armed.delete(callKeyText(listener.key)) ? 'cancelled' : 'not_armed')),
    armed: () => [...armed.values()],
  };
}

export function memoryEmitter(faults: Faults): MemoryEmitter {
  const emitted = new Map<string, JsonObject>();
  return {
    emit: (emission: EmitEvent) =>
      Effect.map(
        faults.attempt(emission, () => {
          const key = callKeyText(emission.key);
          const known = emitted.has(key);
          emitted.set(key, emission.event);
          return known;
        }),
        (known) => (known ? 'already_recorded' : 'recorded'),
      ),
    emitted: () => [...emitted.values()],
  };
}
