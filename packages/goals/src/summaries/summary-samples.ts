import type { FunctionStart } from '@on.auto/workflow-host';
import { Effect, Schema } from 'effect';

import { assessmentIdOf, summaryRunIdOf } from '../assessments/assessment-identity.ts';
import { clockKey, clocksName } from '../goal-tables/clock-rows.ts';
import { summariesName } from '../goal-tables/summary-rows.ts';
import type { NoticePorts } from '../notices/notice-ledger.ts';
import {
  experiments,
  monday,
  noticeBookOf,
  sales,
  startsAnswering,
  type Answer,
  type NoticeBook,
} from '../notices/notice-samples.ts';
import { noticedPlaybookIn } from '../notices/noticed-playbooks.ts';
import { summariesDueOf } from './summaries-due.ts';

export const hour = 3_600_000;

export const friday = Date.parse('2026-11-13T09:00:00.000Z');

export const week = 7 * 24 * hour;

export const weekly = {
  ...experiments,
  notify: { ...experiments.notify, summary: { cron: '0 9 * * 5' } },
};

export const savedAt = monday - hour;

export function fridayRun(due = friday): string {
  return summaryRunIdOf(weekly.id, due);
}

export interface SummaryBook {
  readonly book: NoticeBook;
  readonly starts: readonly FunctionStart[];
  readonly ports: NoticePorts;
  readonly work: ReturnType<typeof summariesDueOf>;
  readonly summaryAt: () => Promise<unknown>;
  readonly summaryRow: () => Promise<Readonly<Record<string, unknown>> | undefined>;
  readonly summaryFacts: () => Promise<readonly string[]>;
}

export interface SummaryBooking {
  readonly goals?: Schema.Json;
  readonly answers?: () => Answer;
  readonly ports?: (ports: NoticePorts) => NoticePorts;
}

async function rowOf(book: NoticeBook, projection: string, key: string) {
  const rows = await Effect.runPromise(
    book.ledger.readProjectedRows(projection, sales, {
      where: [{ column: 'row_key', equals: key }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
  );
  return rows[0]?.row;
}

export async function summaryBookOf({
  goals = [weekly],
  answers = () => 'started',
  ports: portsOver = (ports) => ports,
}: SummaryBooking = {}): Promise<SummaryBook> {
  const book = noticeBookOf();
  await book.playbookCreated();
  await book.goalsSaved(goals);
  const seen = startsAnswering(answers);
  const ports = portsOver({
    ledger: book.ledger,
    start: seen.start,
    playbookOf: noticedPlaybookIn(book.ledger),
    linkOf: ({ goal, per }) =>
      `https://studio.test/?playbook=sales&goal=${goal}${per === undefined ? '' : `&per=${per}`}`,
  });
  return {
    book,
    starts: seen.starts,
    ports,
    work: summariesDueOf(ports),
    summaryAt: async () => (await rowOf(book, clocksName, clockKey))?.['summary_at'],
    summaryRow: () => rowOf(book, summariesName, weekly.id),
    summaryFacts: () => book.factsOf(`goal-summaries/${weekly.id}`),
  };
}

export function inputOf(start: FunctionStart | undefined): Readonly<Record<string, unknown>> {
  return Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(start?.input);
}

const minute = 60_000;

export function iso(at: number): string {
  return new Date(at).toISOString();
}

export function summaryReference(due = friday): string {
  return `goals/${weekly.id}/summaries/${iso(due)}`;
}

export function inTurn<Item>(
  items: readonly Item[],
  work: (item: Item, index: number) => Promise<void>,
): Promise<void> {
  return items.reduce<Promise<void>>(async (before, item, index) => {
    await before;
    await work(item, index);
  }, Promise.resolve());
}

const byThePlaybook = (at: string) => ({ at, by: 'playbook:sales' });

async function thingJudged({ book }: SummaryBook, per: string, index: number, count: number): Promise<void> {
  const stream = `assessments/${assessmentIdOf({ goal: weekly.id, per })}`;
  const at = iso(savedAt + hour + Math.min(index, count - 2) * minute);
  const opened = { goal: weekly.id, goals_version: 1, per: { id: per }, rule: openRule, milestones: [] };
  await book.append(
    stream,
    'goal_assessment_opened',
    opened,
    byThePlaybook(iso(savedAt + hour + Math.min(index, count - 4) * minute)),
  );
  const source = { record: `r-${per}`, run: `run-${per}`, workflow: 'measure', version: 1, entry: 0 };
  const titled = index === 0 ? { title: 'The spring trial' } : {};
  const measurement = { value: index % 2, final: true, as_of: at };
  await book.append(stream, 'goal_observed', { source, at, measurement, ...titled }, byThePlaybook(at));
  const verdict = { verdict: index % 2 === 1 ? 'passed' : 'failed', at, by: 'crossing', told: 'summary' };
  await (index < count - 1
    ? book.append(stream, 'goal_assessed', verdict, byThePlaybook(at))
    : book.append(stream, 'goal_overdue', { since: at, told: 'summary' }, byThePlaybook(at)));
}

const openRule = { settles: 'on_crossing', target: { at_least: 1 } };

export function thingsJudged(summary: SummaryBook, count: number): Promise<void> {
  const things = Array.from({ length: count }, (_, index) => `experiment-${String(index + 10)}`);
  return inTurn(things, (per, index) => thingJudged(summary, per, index, count));
}

function calendarOpened(window: Schema.Json, opens: string, closes: string): Schema.Json {
  return {
    goal: weekly.id,
    goals_version: 1,
    window: { opens, closes, due: closes },
    rule: { settles: 'at_close', target: { at_least: 1 }, window },
    milestones: [],
  };
}

const endedWindows: readonly (readonly [string, Schema.Json])[] = [
  [
    'week',
    calendarOpened(
      { calendar: 'week', time_zone: 'America/Los_Angeles' },
      '2026-11-09T08:00:00.000Z',
      '2026-11-10T08:00:00.000Z',
    ),
  ],
  ['month', calendarOpened({ calendar: 'month' }, '2026-11-01T00:00:00.000Z', '2026-11-10T00:00:00.000Z')],
  ['whole', calendarOpened({ after: 'live', for: 'P1D' }, '2026-11-09T00:00:00.000Z', '2026-11-10T00:00:00.000Z')],
];

export function windowsEnded({ book }: SummaryBook): Promise<void> {
  return inTurn(endedWindows, async ([name, data]) => {
    await book.append(`assessments/${name}`, 'goal_assessment_opened', data, byThePlaybook(iso(savedAt)));
    await book.append(
      `assessments/${name}`,
      'goal_assessment_ended',
      { reason: 'playbook_retired' },
      byThePlaybook(iso(friday - hour)),
    );
  });
}

export function clockRowPorts(
  ledger: NoticePorts['ledger'],
  goals: string,
  moved: (key: string, advance: unknown) => void,
) {
  const clock = [{ org: 'acme', playbook: 'sales', key: 'clock', row: { goals } }];
  return (ports: NoticePorts): NoticePorts => ({
    ...ports,
    ledger: {
      ...ledger,
      readDueRows: () => Effect.succeed(clock),
      readProjectedRows: () => Effect.succeed(clock),
      advanceRow: (_projection, _address, key, advance) =>
        Effect.sync(() => {
          moved(key, advance);
        }),
    },
  });
}

export function linesOf(start: FunctionStart | undefined): readonly unknown[] {
  return Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(inputOf(start)['lines']);
}
