import { definitionFactTypes } from '@on.auto/definitions';
import type { RecordedEvent } from '@on.auto/operations';

const factTypes: ReadonlySet<string> = new Set([
  'run_started',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  ...definitionFactTypes,
]);

export const noRecordTypes: ReadonlySet<string> = new Set();

export function recordTypesOf(eventTypes: readonly string[]): ReadonlySet<string> {
  const facts = eventTypes.filter((type) => factTypes.has(type));
  return new Set(facts.length < eventTypes.length ? [...facts, 'event_published'] : facts);
}

const aDefinitionKey = /^definition\/[^/]+\/[^/]+\//u;

export function streamWithinItsKey(playbookKey: string, stream: string): string {
  return stream.startsWith(playbookKey) ? stream.slice(playbookKey.length) : stream.replace(aDefinitionKey, '');
}

export function keyOfTheStream(playbookKey: string, stream: string): string {
  return stream.slice(0, stream.length - streamWithinItsKey(playbookKey, stream).length);
}

export function relativeRecord(playbookKey: string, record: RecordedEvent): RecordedEvent {
  return { ...record, stream: streamWithinItsKey(playbookKey, record.stream) };
}
