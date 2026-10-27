import type { ConnectionPorts } from '@on.auto/ledger';

import { openLicenseClock, type ClockSamples } from '../index.ts';
import type { MeterDatabase } from './database.ts';

export function testClock() {
  const state = { wall: 100_000, monotonic: 0 };
  const samples: ClockSamples = { wallTime: () => state.wall, monotonicTime: () => state.monotonic };
  function on(connection: ConnectionPorts): ConnectionPorts {
    return connection.sharedClock === null
      ? connection
      : { ...connection, sharedClock: () => Promise.resolve(state.wall) };
  }
  return {
    state,
    samples,
    on,
    pass: (elapsed: number) => {
      state.wall += elapsed;
      state.monotonic += elapsed;
    },
  };
}

export async function clockFixture(open: () => Promise<MeterDatabase>) {
  const database = await open();
  const time = testClock();
  const connection = time.on(database.connection);
  const clock = await openLicenseClock(connection, time.samples);
  async function replica() {
    const next = await database.reopen();
    return openLicenseClock(time.on(next.connection), time.samples);
  }
  return { database, connection, clock, time, replica };
}
