import type { Trigger } from '@on.auto/definitions';

import { cronTrigger, eventTrigger, everyTrigger } from '../src/reaction-testing/playbook-writes.ts';

export type TriggersOf = (type: string) => readonly Trigger[];

export function anEventTrigger(type: string): readonly Trigger[] {
  return [eventTrigger({ type })];
}

export function threeTriggers(type: string): readonly Trigger[] {
  return [eventTrigger({ type }), cronTrigger('0 0 1 1 *'), everyTrigger(3_600_000)];
}

export function savedNow(): string {
  return new Date().toISOString();
}
