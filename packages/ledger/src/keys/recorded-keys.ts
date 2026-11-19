import type { RecordedSelection } from '@on.auto/operations';

import type {
  AppendedFactsAsked,
  AppendedStreams,
  FactScope,
  RecordedPoint,
  StoredAppendedFacts,
  StoredPage,
  StoredPageRequest,
  StoredRecord,
} from '../event-store.ts';

export interface OrgPageAsked extends Omit<StoredPageRequest, 'since'> {
  readonly to?: RecordedPoint;
}

interface OrgRecordsStore {
  readonly readRecordedOfOrg: (org: string, page: OrgPageAsked) => Promise<StoredPage>;
}

export interface RecordedKeys {
  readonly org: string;
  readonly keys: readonly [string, ...string[]];
}

type ReadOf<Scope> = (scope: Scope, selection: RecordedSelection, page: StoredPageRequest) => Promise<StoredPage>;

type EventReadOf<Scope> = (scope: Scope, id: string) => Promise<StoredRecord | undefined>;

export interface RecordedStore extends OrgRecordsStore {
  readonly pointLength: number;
  readonly readRecorded: ReadOf<string>;
  readonly readRecordedOfKeys: ReadOf<RecordedKeys>;
  readonly readAppended: (after: RecordedPoint | undefined, most: number) => Promise<AppendedStreams>;
  readonly readAppendedFacts: (scope: FactScope, asked: AppendedFactsAsked) => Promise<StoredAppendedFacts>;
  readonly readRecordedEvent: EventReadOf<string>;
  readonly readRecordedEventOfKeys: EventReadOf<RecordedKeys>;
}

const theOrgOfAKey = /^[^/]*\/([^/]*)\//u;

export function keysOfOne(key: string): RecordedKeys {
  return { org: theOrgOfAKey.exec(key)?.[1] ?? '', keys: [key] };
}

function streamsOfTheRunUnder(key: string, run: string): readonly [string, string] {
  return [`${key}runs/${run}`, `${key}run-logs/${run}`];
}

export function streamsOfTheRun([only, ...more]: RecordedKeys['keys'], run: string): RecordedKeys['keys'] {
  return [...streamsOfTheRunUnder(only, run), ...more.flatMap((key) => streamsOfTheRunUnder(key, run))];
}
