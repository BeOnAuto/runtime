import { definitionFactTypes } from '@on.auto/definitions';
import { orgRecordedReaderOf, playbookKeyOfStream, type LedgerStreams } from '@on.auto/ledger';
import {
  definitionOfStreamPrefix,
  playbookOfStreamPrefix,
  type RecordedEvent,
  type RecordedPage,
} from '@on.auto/operations';
import { Effect, Function, Option } from 'effect';

const recordsInAPage = 100;

export interface OrgRecords {
  readonly after: (
    org: string,
    cursor: string | null,
    delivers: ReadonlySet<string>,
    through?: string,
  ) => Effect.Effect<RecordedPage>;
}

export function orgRecordsOf(store: Pick<LedgerStreams, 'readRecordedOfOrg' | 'pointLength'>): OrgRecords {
  const read = orgRecordedReaderOf(store);
  return {
    after: (org, cursor, delivers, through) =>
      Effect.orDie(
        read(org, {
          order: 'asc',
          limit: recordsInAPage,
          dataOf: [...new Set([...definitionFactTypes, ...delivers])],
          ...(cursor === null ? {} : { cursor }),
          ...(through === undefined ? {} : { through }),
        }),
      ),
  };
}

export function wokenOrgOf(stream: string): string | undefined {
  const key = playbookKeyOfStream(stream);
  if (key === undefined || stream.startsWith(`${key}run-logs/`)) {
    return undefined;
  }
  const address = Option.orElse(playbookOfStreamPrefix(key), () => definitionOfStreamPrefix(key));
  return Option.getOrUndefined(Option.map(address, ({ org }) => org));
}

export type PlaybookOfARecord = (record: Pick<RecordedEvent, 'stream'>) => Effect.Effect<string | undefined>;

export function playbooksOfRecords(names: Pick<LedgerStreams, 'nameHeldBy'>): PlaybookOfARecord {
  const known = new Map<string, string | undefined>();
  const placed = (definitionKey: string): Effect.Effect<string | undefined> =>
    known.has(definitionKey)
      ? Effect.succeed(known.get(definitionKey))
      : Effect.map(
          Effect.promise(() => names.nameHeldBy(definitionKey)),
          (held) => {
            known.set(definitionKey, held?.playbookKey);
            return held?.playbookKey;
          },
        );
  const followedByNone: Effect.Effect<string | undefined> = Effect.sync(Function.constUndefined);
  return ({ stream }) => {
    const key = playbookKeyOfStream(stream) ?? '';
    if (Option.isSome(playbookOfStreamPrefix(key))) {
      return Effect.succeed(key);
    }
    return Option.isSome(definitionOfStreamPrefix(key)) ? placed(key) : followedByNone;
  };
}
