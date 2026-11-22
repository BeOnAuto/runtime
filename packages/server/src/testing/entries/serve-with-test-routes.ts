import { once } from 'node:events';

import { Schema } from 'effect';

import { exitOnStartupFailure, runServer } from '../../lifecycle/run-server.ts';
import { stopInsistedBy, stopRequestedBy } from '../../lifecycle/stop-request.ts';
import { servedBy } from '../../server-options/server-options.ts';
import { listenerClosedLine } from '../processes/accepting-connections.ts';
import { shortShutdownTimeoutMs, shutdownTimeoutVariable } from '../processes/shutdown-timeouts.ts';
import { callInFlightLine, toldToTheTest } from './calls-in-flight.ts';
import { optionsServing } from './serving-options.ts';
import { testRoutesHeldBy, type RequestHold } from './test-routes.ts';

const decodeTimeout = Schema.decodeUnknownSync(Schema.FiniteFromString);

const givenShutdownTimeout = process.env[shutdownTimeoutVariable];

const say = toldToTheTest();

const heldUntilNudged: RequestHold = {
  arrived: () => {
    say(callInFlightLine);
  },
  released: () => once(process, 'SIGUSR2'),
};

const stopRequested = stopRequestedBy(process);

const stopInsisted = stopInsistedBy(process);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    setImmediate(() => {
      say(listenerClosedLine);
    });
  });
}

await runServer(
  process,
  {
    ...optionsServing(() => servedBy([testRoutesHeldBy(heldUntilNudged)])),
    shutdownTimeoutMs:
      givenShutdownTimeout === undefined ? shortShutdownTimeoutMs : decodeTimeout(givenShutdownTimeout),
  },
  stopRequested,
  stopInsisted,
).catch(exitOnStartupFailure(process));
