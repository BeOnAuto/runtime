import { recordedDecoder } from '@on.auto/operations';
import { Option } from 'effect';

import { noStrippedForms, runnableAttributes, type StrippedForms } from '../capability/stripped-forms.ts';
import {
  DefinitionEventSchema,
  isDefinitionSaved,
  type DefinitionSaved,
  type DefinitionWithContent,
  type RecordedDefinitionEvent,
} from './definition-events.ts';
import type { Trigger } from './definition-triggers.ts';

export type DefinitionChange =
  | {
      readonly kind: 'activated';
      readonly name: string;
      readonly version: number;
      readonly triggers: readonly Trigger[];
      readonly at: string;
    }
  | { readonly kind: 'deactivated'; readonly name: string }
  | { readonly kind: 'retired'; readonly name: string }
  | { readonly kind: 'paused'; readonly name: string }
  | { readonly kind: 'resumed'; readonly name: string; readonly at: string }
  | {
      readonly kind: 'restored';
      readonly name: string;
      readonly version: number;
      readonly triggers: readonly Trigger[];
      readonly at: string;
    }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'unreadable' };

const decodeDefinitionEvent = recordedDecoder(DefinitionEventSchema);

const unreadable: DefinitionChange = { kind: 'unreadable' };

function runnableTrigger(trigger: Trigger, stripped: StrippedForms): Trigger {
  return trigger.kind === 'event'
    ? {
        ...trigger,
        filters: trigger.filters.map((filter) => ({
          ...filter,
          attributes: runnableAttributes(filter.attributes, stripped),
        })),
      }
    : trigger;
}

function standingChangeOf(event: Exclude<RecordedDefinitionEvent, DefinitionWithContent>): DefinitionChange {
  const { at, definitionName: name } = event.context;
  if (event.type === 'definition_paused') {
    return { kind: 'paused', name };
  }
  return event.type === 'definition_resumed' ? { kind: 'resumed', name, at } : { kind: 'retired', name };
}

function runnableTriggersOf({ triggers = [], stripped = noStrippedForms }: DefinitionWithContent['data']['content']) {
  return triggers.map((each) => runnableTrigger(each, stripped));
}

function savedChangeOf(event: DefinitionSaved): DefinitionChange {
  const { at, definitionName: name, definitionVersion: version } = event.context;
  const triggers = runnableTriggersOf(event.data.content);
  if (triggers.length > 0) {
    return { kind: 'activated', name, version, triggers, at };
  }
  return event.type === 'definition_updated' ? { kind: 'deactivated', name } : { kind: 'unchanged' };
}

export function definitionChangeOf(recorded: unknown): DefinitionChange {
  return Option.match(decodeDefinitionEvent(recorded), {
    onNone: () => unreadable,
    onSome: (event): DefinitionChange => {
      if (isDefinitionSaved(event)) {
        return savedChangeOf(event);
      }
      if (event.type !== 'definition_restored') {
        return standingChangeOf(event);
      }
      const { at, definitionName: name, definitionVersion: version } = event.context;
      return { kind: 'restored', name, version, triggers: runnableTriggersOf(event.data.content), at };
    },
  });
}
