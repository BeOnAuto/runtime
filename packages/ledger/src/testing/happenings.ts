import {
  ContextSchema,
  type PlaybookAddress,
  type Context,
  type Decided,
  type Decider,
  type Ledger,
  type RecordedFact,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedSelection,
} from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';

const HappenedSchema = Schema.Struct({
  type: Schema.String,
  data: Schema.Struct({ detail: Schema.Json }),
  context: ContextSchema,
});

export type Happened = Decided<typeof HappenedSchema.Type>;

export const stamped: Context = { at: '2026-10-05T09:00:00.000Z', by: 'tester' };

export const happenings: Decider<null, readonly Happened[], typeof HappenedSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: (happened) => Result.succeed(happened),
  context: () => stamped,
  eventSchema: HappenedSchema,
};

export type AnyLedger = Ledger['Service'];

export type LedgerMaker = () => Promise<AnyLedger>;

export const alpha: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

export function happen(ledger: AnyLedger, stream: string, ...happened: readonly Happened[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, happenings, happened));
}

export function noted(type: string, detail: Schema.Json = null): Happened {
  return { type, data: { detail } };
}

export function reading(
  ledger: AnyLedger,
  selection: RecordedSelection,
  page: RecordedPageRequest,
  playbook: PlaybookAddress = alpha,
): Promise<RecordedPage> {
  return Effect.runPromise(ledger.readRecorded(playbook, selection, page));
}

const decodeHappened = Schema.decodeUnknownSync(Schema.Struct({ detail: Schema.Json }));

export function detailsOf(records: readonly RecordedFact[]): readonly Schema.Json[] {
  return records.map(({ data }) => decodeHappened(data).detail);
}

export function details({ records }: RecordedPage): readonly Schema.Json[] {
  return detailsOf(records);
}

export function streamsAndTypes({ records }: RecordedPage): readonly string[] {
  return records.map(({ stream, type }) => `${stream} ${type}`);
}

export function inAlpha(relative: string): string {
  return `playbook/acme/alpha/${relative}`;
}
