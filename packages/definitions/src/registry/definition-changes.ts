import { recordedDecoder } from '@on.auto/operations';
import { Option } from 'effect';

import { noStrippedForms, runnableAttributes, type StrippedForms } from '../capability/stripped-forms.ts';
import { DefinitionEventSchema } from './definition-events.ts';
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

export function definitionChangeOf(recorded: unknown): DefinitionChange {
  return Option.match(decodeDefinitionEvent(recorded), {
    onNone: () => unreadable,
    onSome: (event): DefinitionChange => {
      const { at, definitionName: name, definitionVersion: version } = event.context;
      if (event.type === 'definition_retired') {
        return { kind: 'deactivated', name };
      }
      const { triggers = [], stripped = noStrippedForms } = event.data.content;
      if (triggers.length > 0) {
        return {
          kind: 'activated',
          name,
          version,
          triggers: triggers.map((each) => runnableTrigger(each, stripped)),
          at,
        };
      }
      return event.type === 'definition_updated' ? { kind: 'deactivated', name } : { kind: 'unchanged' };
    },
  });
}
