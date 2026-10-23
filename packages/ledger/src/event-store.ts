import type { SQL } from '@event-driven-io/dumbo';
import type {
  ContentStore,
  Context,
  ProjectionAdvancer,
  ProjectionReader,
  Lineage,
  RecordedOrder,
  RecordedSelection,
  RunOutcomeGroup,
  RunOutcomeSelection,
  RunOutcomeWindow,
} from '@on.auto/operations';
import type { Schema } from 'effect';

export interface EncodedEvent {
  readonly type: string;
  readonly data: Schema.JsonObject;
}

export interface MessageLineage extends Lineage {
  readonly id: string;
}

export interface RecordedMessage {
  readonly type: string;
  readonly data: unknown;
  readonly context: Context;
  readonly lineage: MessageLineage;
}

export interface AppendPlace {
  readonly expectedVersion: number;
  readonly context: Context;
  readonly lineage?: Lineage;
}

export interface AppendObserver {
  readonly appended: (stream: string, events: readonly EncodedEvent[], place: AppendPlace) => void;
}

export interface RecordedStream {
  readonly version: number;
  readonly messages: readonly RecordedMessage[];
}

export type RecordedPoint = readonly string[];

export interface StoredPageRequest {
  readonly after?: RecordedPoint;
  readonly at?: RecordedPoint;
  readonly order: RecordedOrder;
  readonly limit: number;
  readonly since?: string;
  readonly types?: readonly string[];
  readonly dataOf?: readonly string[];
}

export interface StoredRecord extends MessageLineage {
  readonly point: RecordedPoint;
  readonly stream: string;
  readonly version: number;
  readonly globalPosition: number;
  readonly type: string;
  readonly data: unknown;
  readonly metadata: StoredMetadata;
  readonly recordedAt: string;
}

export interface StoredMetadata {
  readonly context: Context;
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface StoredPlace {
  readonly point: RecordedPoint;
  readonly recordedAt: string;
}

export interface StoredPage {
  readonly records: readonly StoredRecord[];
  readonly resumeAfter?: RecordedPoint;
  readonly lastExamined?: StoredPlace;
}

export interface Streams {
  readonly mostEventsInOneAppend: number;
  readonly read: (stream: string, after?: number) => Promise<RecordedStream>;
  readonly append: (stream: string, events: readonly EncodedEvent[], place: AppendPlace) => Promise<void>;
}

export interface StreamStore extends Streams {
  readonly migrate: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface AppendedStreams {
  readonly streams: readonly string[];
  readonly through: RecordedPoint;
  readonly more: boolean;
}

export interface RecordedStore {
  readonly pointLength: number;
  readonly readRecorded: (
    playbookKey: string,
    selection: RecordedSelection,
    page: StoredPageRequest,
  ) => Promise<StoredPage>;
  readonly readAppended: (after: RecordedPoint | undefined, most: number) => Promise<AppendedStreams>;
  readonly readRecordedEvent: (playbookKey: string, id: string) => Promise<StoredRecord | undefined>;
}

export interface DefinitionStream {
  readonly stream: string;
  readonly version: number;
}

export interface DefinitionStreamsStore {
  readonly definitionStreams: (definitionType: string) => Promise<readonly DefinitionStream[]>;
}

export interface LedgerStreams extends Streams, RecordedStore, DefinitionStreamsStore {}

export interface EventStore extends StreamStore, LedgerStreams {}

export interface RunOutcomesStore {
  readonly readRunOutcomes: (
    playbookKey: string,
    window: RunOutcomeWindow,
    selection: RunOutcomeSelection,
  ) => Promise<readonly RunOutcomeGroup[]>;
}

export interface LedgerStore extends EventStore, RunOutcomesStore, ProjectionReader, ProjectionAdvancer, ContentStore {}

export interface StatementExecutor {
  readonly query: (sql: SQL) => Promise<{ readonly rows: readonly unknown[] }>;
  readonly command: (sql: SQL) => Promise<unknown>;
}

interface Transaction {
  readonly execute: StatementExecutor;
}

export interface TransactionalPool<Executor extends StatementExecutor = StatementExecutor> {
  readonly execute: Executor;
  readonly withTransaction: (handle: (transaction: Transaction) => Promise<void>) => Promise<void>;
}

export type InTransaction = (work: (execute: StatementExecutor) => Promise<void>) => Promise<void>;

export function inTransactionOf({ withTransaction }: TransactionalPool): InTransaction {
  return (work) => withTransaction((transaction) => work(transaction.execute));
}
