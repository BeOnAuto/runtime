import {
  boundedPage,
  contextOf,
  mostExaminedInAPage,
  type Examined,
  type RecordedOrder,
  type RecordedSelection,
} from '@on.auto/operations';
import { Schema } from 'effect';

import type {
  AppendedFactsAsked,
  FactPlace,
  FactScope,
  MessageLineage,
  RecordedPoint,
  RecordedStore,
  StoredMetadata,
  StoredPage,
  StoredPageRequest,
  StoredPlace,
  StoredRecord,
} from '../event-store.ts';

export interface RecordHead extends MessageLineage {
  readonly point: RecordedPoint;
  readonly stream: string;
  readonly version: number;
  readonly globalPosition: number;
  readonly type: string;
  readonly metadata: StoredMetadata;
  readonly recordedAt: string;
  readonly size: number;
}

const TraceSchema = Schema.Struct({
  causationId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  traceId: Schema.optionalKey(Schema.String),
  spanId: Schema.optionalKey(Schema.String),
});

const decodeTrace = Schema.decodeUnknownSync(TraceSchema);

export interface ReadMetadata {
  readonly causationId: string | null;
  readonly metadata: StoredMetadata;
}

export function readMetadataOf(stored: unknown): ReadMetadata {
  const { causationId = null, traceId, spanId } = decodeTrace(stored);
  return {
    causationId,
    metadata: {
      context: contextOf(stored),
      ...(traceId === undefined ? {} : { traceId }),
      ...(spanId === undefined ? {} : { spanId }),
    },
  };
}

export interface ExaminedItem extends Examined {
  readonly point: RecordedPoint;
  readonly heads: readonly [RecordHead, ...RecordHead[]];
}

export interface ExaminationScope {
  readonly order: RecordedOrder;
  readonly examineAtMost: number;
  readonly answerAtMost: number;
  readonly types?: readonly string[];
  readonly sized?: readonly string[];
  readonly after?: RecordedPoint;
  readonly at?: RecordedPoint;
  readonly from?: RecordedPoint;
  readonly to?: RecordedPoint;
}

export interface RecordedStatements {
  readonly firstPointSince: (playbookKey: string, since: string) => Promise<RecordedPoint | undefined>;
  readonly examineRecords: (records: RecordsSelected, scope: ExaminationScope) => Promise<readonly ExaminedItem[]>;
  readonly examineRuns: (scope: ExaminationScope, runs: RunsSelected) => Promise<readonly ExaminedItem[]>;
  readonly dataAt: (points: readonly RecordedPoint[]) => Promise<ReadonlyMap<string, unknown>>;
}

export type RunsSelected = Extract<RecordedSelection, { readonly kind: 'runs' }> & { readonly playbookKey: string };

export type RecordsSelected =
  | FactScope
  | { readonly kind: 'correlated'; readonly playbookKey: string; readonly correlation: string };

export function pointKey(point: RecordedPoint): string {
  return point.join(':');
}

function asksForOneDefinition(selection: RecordedSelection): boolean {
  return selection.kind === 'runs' && (selection.definitionType !== undefined || selection.name !== undefined);
}

function scopeOf(
  selection: RecordedSelection,
  { order, limit, types, dataOf, after, at }: StoredPageRequest,
): ExaminationScope {
  const filtering = types !== undefined || asksForOneDefinition(selection);
  return {
    order,
    examineAtMost: filtering ? mostExaminedInAPage : limit,
    answerAtMost: filtering ? limit + 2 : limit + 1,
    ...(types === undefined ? {} : { types }),
    ...(dataOf === undefined ? {} : { sized: dataOf }),
    ...(after === undefined ? {} : { after }),
    ...(at === undefined ? {} : { at }),
  };
}

function selectedOf(
  playbookKey: string,
  selection: Exclude<RecordedSelection, { readonly kind: 'runs' }>,
): RecordsSelected {
  if (selection.kind === 'run') {
    return {
      kind: 'streams',
      streams: [`${playbookKey}runs/${selection.run}`, `${playbookKey}run-logs/${selection.run}`],
    };
  }
  return selection.kind === 'correlated' ? { ...selection, playbookKey } : { kind: 'playbook', playbookKey };
}

function examine(
  statements: RecordedStatements,
  playbookKey: string,
  selection: RecordedSelection,
  scope: ExaminationScope,
): Promise<readonly ExaminedItem[]> {
  if (selection.kind === 'runs') {
    return statements.examineRuns(scope, { ...selection, playbookKey });
  }
  return statements.examineRecords(selectedOf(playbookKey, selection), scope);
}

type Loads = (head: RecordHead) => boolean;

function loadsOf(dataOf: readonly string[] | undefined): Loads {
  return dataOf === undefined ? () => true : ({ type }) => dataOf.includes(type);
}

function sizedBy(loads: Loads, dataOf: readonly string[] | undefined, item: ExaminedItem): ExaminedItem {
  return dataOf === undefined || !item.wanted
    ? item
    : { ...item, size: item.heads.filter((head) => loads(head)).reduce((sum, { size }) => sum + size, 0) };
}

export function recordOf(head: RecordHead, data: unknown): StoredRecord {
  const { point, id, causationId, correlationId, stream, version, globalPosition, type, metadata, recordedAt } = head;
  return { point, id, causationId, correlationId, stream, version, globalPosition, type, data, metadata, recordedAt };
}

function placeOf({ point, heads: [first] }: ExaminedItem): StoredPlace {
  return { point, recordedAt: first.recordedAt };
}

interface PageAsked {
  readonly playbookKey: string;
  readonly selection: RecordedSelection;
}

async function pageWithin(
  statements: RecordedStatements,
  { playbookKey, selection }: PageAsked,
  page: Pick<StoredPageRequest, 'limit' | 'dataOf'>,
  scope: ExaminationScope,
): Promise<StoredPage> {
  const loads = loadsOf(page.dataOf);
  const examined = (await examine(statements, playbookKey, selection, scope)).map((item) =>
    sizedBy(loads, page.dataOf, item),
  );
  const { delivered, resumeAfter, lastExamined } = boundedPage(examined, page.limit, scope.examineAtMost);
  const heads = delivered.flatMap((item) => item.heads);
  const loaded = heads.filter((head) => loads(head));
  const data =
    loaded.length === 0 ? new Map<string, unknown>() : await statements.dataAt(loaded.map(({ point }) => point));
  const records = heads.map((head) => recordOf(head, data.get(pointKey(head.point))));
  return {
    records,
    ...(resumeAfter === undefined ? {} : { resumeAfter: resumeAfter.point }),
    ...(lastExamined === undefined ? {} : { lastExamined: placeOf(lastExamined) }),
  };
}

export function recordedReadingOver(statements: RecordedStatements): RecordedStore['readRecorded'] {
  return async (playbookKey, selection, page) => {
    const scope = scopeOf(selection, page);
    const asked = { playbookKey, selection };
    if (page.since === undefined) {
      return pageWithin(statements, asked, page, scope);
    }
    const from = await statements.firstPointSince(playbookKey, page.since);
    return from === undefined ? { records: [] } : pageWithin(statements, asked, page, { ...scope, from });
  };
}

type FactStatements = Pick<RecordedStatements, 'examineRecords' | 'dataAt'>;

type NowPoint = () => Promise<RecordedPoint>;

export function nowOf(readAppended: RecordedStore['readAppended']): NowPoint {
  return async () => (await readAppended(undefined, 0)).through;
}

const measuringNothing = { sized: [] } as const;

function factPlaceOf({ point, id }: RecordHead): FactPlace {
  return { point, id };
}

async function headsIn(
  statements: FactStatements,
  scope: FactScope,
  examined: ExaminationScope,
): Promise<readonly RecordHead[]> {
  const items = await statements.examineRecords(scope, { ...examined, ...measuringNothing });
  return items.flatMap(({ heads }) => heads);
}

function isThePlace(head: RecordHead | undefined, { point, id }: FactPlace): boolean {
  return head !== undefined && head.id === id && pointKey(head.point) === pointKey(point);
}

async function newestBy(
  statements: FactStatements,
  scope: FactScope,
  through: RecordedPoint,
): Promise<FactPlace | null> {
  const [newest] = await headsIn(statements, scope, { order: 'desc', at: through, examineAtMost: 1, answerAtMost: 1 });
  return newest === undefined ? null : factPlaceOf(newest);
}

async function withTheDataOf(
  statements: FactStatements,
  heads: readonly RecordHead[],
  dataOf: readonly string[],
): Promise<readonly StoredRecord[]> {
  const loaded = heads.filter(({ type }) => dataOf.includes(type));
  const data =
    loaded.length === 0 ? new Map<string, unknown>() : await statements.dataAt(loaded.map(({ point }) => point));
  return heads.map((head) => recordOf(head, data.get(pointKey(head.point))));
}

async function headsAfter(
  statements: FactStatements,
  scope: FactScope,
  after: FactPlace | null,
  { most, through }: { readonly most: number; readonly through: RecordedPoint },
): Promise<readonly RecordHead[] | undefined> {
  if (after === null) {
    return headsIn(statements, scope, { order: 'asc', to: through, examineAtMost: most, answerAtMost: most + 1 });
  }
  const [first, ...rest] = await headsIn(statements, scope, {
    order: 'asc',
    at: after.point,
    to: through,
    examineAtMost: most + 1,
    answerAtMost: most + 2,
  });
  return isThePlace(first, after) ? rest : undefined;
}

export function appendedFactsOver(statements: FactStatements, nowPoint: NowPoint): RecordedStore['readAppendedFacts'] {
  return async (scope, { after, most, dataOf }: AppendedFactsAsked) => {
    const through = await nowPoint();
    if (after === undefined) {
      return { held: true, facts: [], last: await newestBy(statements, scope, through), through, more: false };
    }
    const heads = await headsAfter(statements, scope, after, { most, through });
    if (heads === undefined) {
      return { held: false };
    }
    const read = heads.slice(0, most);
    const last = read.at(-1);
    if (last === undefined) {
      return { held: true, facts: [], last: after, through, more: false };
    }
    const more = heads.length > most;
    return {
      held: true,
      facts: await withTheDataOf(statements, read, dataOf),
      last: factPlaceOf(last),
      through: more ? last.point : through,
      more,
    };
  };
}
