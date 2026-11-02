import {
  DefinitionEventSchema,
  runEventOf,
  type RecordedDefinitionEvent,
  type RecordedRunEvent,
} from '@on.auto/definitions';
import {
  recordedDecoder,
  type DefinitionContext,
  type ProjectedColumn,
  type ProjectedMessage,
  type RunContext,
} from '@on.auto/operations';
import { Option } from 'effect';

export type ActivityFact = RecordedRunEvent | RecordedDefinitionEvent;

const definitionEventOf = recordedDecoder(DefinitionEventSchema);

export function activityFactOf(message: ProjectedMessage): ActivityFact | undefined {
  return Option.getOrElse(definitionEventOf(message), (): ActivityFact | undefined => runEventOf(message));
}

export const mostLineCharacters = 200;

const ellipsis = '…';

function codePointsOf(text: string): readonly string[] {
  return Array.from(text);
}

export function lineOf(text: string): string {
  const characters = codePointsOf(text.split(/\r?\n/u, 1).join('').trim());
  return characters.length > mostLineCharacters
    ? `${characters.slice(0, mostLineCharacters - 1).join('')}${ellipsis}`
    : characters.join('');
}

export function millisecondsOf(time: string): number {
  return Date.parse(time);
}

export function isTopLevel({ calledBy }: RunContext): boolean {
  return calledBy === undefined;
}

export function definitionColumnsOf({ definitionType, definitionName, definitionVersion }: DefinitionContext) {
  return { definition_type: definitionType, definition_name: definitionName, definition_version: definitionVersion };
}

export function triggerOf({ trigger }: RunContext): string | null {
  return trigger === undefined ? null : JSON.stringify(trigger);
}

export const definitionColumns: readonly ProjectedColumn[] = [
  { name: 'definition_type', kind: 'text' },
  { name: 'definition_name', kind: 'text' },
  { name: 'definition_version', kind: 'integer' },
];
