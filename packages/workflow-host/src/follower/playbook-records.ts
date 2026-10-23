import { recordedReaderOf, type EventStore } from '@on.auto/ledger';
import type { PlaybookAddress, RecordedEvent, RecordedPage } from '@on.auto/operations';
import { Effect } from 'effect';

const recordsInAPage = 100;

const definitionTypes: readonly string[] = ['definition_created', 'definition_updated', 'definition_retired'];

const factTypes: ReadonlySet<string> = new Set([
  'run_started',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  ...definitionTypes,
]);

export const noRecordTypes: ReadonlySet<string> = new Set();

export function recordTypesOf(eventTypes: readonly string[]): ReadonlySet<string> {
  const facts = eventTypes.filter((type) => factTypes.has(type));
  return new Set(facts.length < eventTypes.length ? [...facts, 'event_published'] : facts);
}

export interface PlaybookRecords {
  readonly after: (
    playbook: PlaybookAddress,
    cursor: string | null,
    delivers: ReadonlySet<string>,
  ) => Effect.Effect<RecordedPage>;
}

export function relativeRecord(playbookKey: string, record: RecordedEvent): RecordedEvent {
  return { ...record, stream: record.stream.slice(playbookKey.length) };
}

export function playbookRecordsOf(store: EventStore): PlaybookRecords {
  const read = recordedReaderOf(store);
  return {
    after: (playbook, cursor, delivers) =>
      Effect.orDie(
        read(
          playbook,
          { kind: 'everything' },
          {
            order: 'asc',
            limit: recordsInAPage,
            dataOf: [...new Set([...definitionTypes, ...delivers])],
            ...(cursor === null ? {} : { cursor }),
          },
        ),
      ),
  };
}
