import type { RiddenAppends } from '../emmett/emmett-event-store.ts';
import type { LedgerStreams } from '../event-store.ts';
import { inTurn } from '../projections/inline-projection.ts';
import type { Rider } from '../scrub/append-riders.ts';
import type { ConnectionPorts } from './ledger-connection.ts';
import type { Statement } from './statement.ts';
import { sqlOf } from './statement.ts';

export type StreamsCarrying = LedgerStreams & RiddenAppends;

export class StatementsFailed extends Error {}

interface Carried {
  readonly rider: Rider;
  readonly failures: () => readonly unknown[];
}

function carried(statements: readonly Statement[]): Carried {
  const failures: unknown[] = [];
  return {
    rider: async (execute) => {
      try {
        await inTurn(statements, (asked) => execute.command(sqlOf(asked)));
      } catch (failure) {
        failures.push(failure);
        throw new StatementsFailed('A statement carried by the append failed', { cause: failure });
      }
    },
    failures: () => failures,
  };
}

export function appendsWithOn(streams: StreamsCarrying): ConnectionPorts['appendWith'] {
  return async (stream, events, place, statements) => {
    if (statements.length === 0) {
      return streams.append(stream, events, place);
    }
    const { rider, failures } = carried(statements);
    try {
      await streams.appendWithin(stream, events, place, rider);
    } catch (failure) {
      const [cause] = failures();
      if (failures().length > 0) {
        throw new StatementsFailed('A statement carried by the append failed, so it kept nothing', { cause });
      }
      throw failure;
    }
  };
}
