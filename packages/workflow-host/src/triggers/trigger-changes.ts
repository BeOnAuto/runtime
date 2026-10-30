import { TriggerSchema, type Trigger } from '@on.auto/definitions';
import { Schema } from 'effect';

export type TriggerChange =
  | { readonly change: 'kept'; readonly trigger: Trigger }
  | { readonly change: 'activated'; readonly trigger: Trigger }
  | { readonly change: 'removed'; readonly reference: string };

const sameTrigger = Schema.toEquivalence(TriggerSchema);

function changeOf(kept: readonly Trigger[], trigger: Trigger): TriggerChange {
  const before = kept.find(({ reference }) => reference === trigger.reference);
  return before !== undefined && sameTrigger(before, trigger)
    ? { change: 'kept', trigger }
    : { change: 'activated', trigger };
}

export function triggerChangesOf(kept: readonly Trigger[], saved: readonly Trigger[]): readonly TriggerChange[] {
  const removed = kept
    .filter(({ reference }) => !saved.some((trigger) => trigger.reference === reference))
    .map(({ reference }): TriggerChange => ({ change: 'removed', reference }));
  return [...saved.map((trigger) => changeOf(kept, trigger)), ...removed];
}
