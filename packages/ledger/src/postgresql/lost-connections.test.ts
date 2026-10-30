import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { until } from '../testing/until.ts';
import { lostConnectionsLoggedWith } from './lost-connections.ts';

describe('a connection to the PostgreSQL database that the database ends', () => {
  it('is logged as a warning with the message of the database, through the loggers of the runtime', async () => {
    const logged: string[] = [];
    const capture = Logger.map(Logger.formatJson, (line: string) => {
      logged.push(line);
    });
    const context = await Effect.runPromise(Effect.context().pipe(Effect.provide(Logger.layer([capture]))));

    lostConnectionsLoggedWith(context)(new Error('terminating connection due to administrator command'));

    await until(() => {
      expect(logged).toEqual([
        expect.stringContaining(
          '{"message":"A connection to the PostgreSQL database of the ledger was lost; the ledger opens another when it needs one","level":"WARN"',
        ),
      ]);
    });
    expect(logged[0]).toContain('"annotations":{"error":"terminating connection due to administrator command"}');
  });
});
