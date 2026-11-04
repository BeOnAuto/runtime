import { counted, plainNumber } from '@on.auto/phrasing';
import { Option, Schema } from 'effect';

const decodeRead = Schema.decodeUnknownOption(
  Schema.Struct({
    output: Schema.Struct({ runs: Schema.Array(Schema.Unknown), more: Schema.Boolean }),
    record: Schema.Struct({ examined: Schema.Int, through: Schema.NullOr(Schema.String) }),
  }),
);

const succeededRun = { one: 'run that succeeded', other: 'runs that succeeded' };

export function runsOutputInWords(output: Schema.Json, record: unknown): string | undefined {
  return Option.getOrUndefined(
    Option.map(decodeRead({ output, record }), ({ output: { runs, more }, record: { examined } }) => {
      const unread = more ? '; older runs are left unread' : '';
      return `It examined ${counted(examined, succeededRun)} and answered with ${plainNumber(runs.length)}${unread}.`;
    }),
  );
}
