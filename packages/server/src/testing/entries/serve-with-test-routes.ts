import { once } from 'node:events';

import { Schema } from 'effect';

import { exitOnStartupFailure, runServer } from '../../lifecycle/run-server.ts';
import { stopInsistedBy, stopRequestedBy } from '../../lifecycle/stop-request.ts';
import { servedBy } from '../../server-options/server-options.ts';
import { shortShutdownTimeoutMs, shutdownTimeoutVariable } from '../processes/shutdown-timeouts.ts';
import { callInFlightAnnouncedIn } from './calls-in-flight.ts';
import { optionsServing } from './serving-options.ts';
import { testRoutesHeldBy, type RequestHold } from './test-routes.ts';

const decodeTimeout = Schema.decodeUnknownSync(Schema.FiniteFromString);

const givenShutdownTimeout = process.env[shutdownTimeoutVariable];

const heldUntilNudged: RequestHold = {
  arrived: callInFlightAnnouncedIn(process.env),
  released: () => once(process, 'SIGUSR2'),
};

await runServer(
  process,
  {
    ...optionsServing(() => servedBy([testRoutesHeldBy(heldUntilNudged)])),
    shutdownTimeoutMs:
      givenShutdownTimeout === undefined ? shortShutdownTimeoutMs : decodeTimeout(givenShutdownTimeout),
  },
  stopRequestedBy(process),
  stopInsistedBy(process),
).catch(exitOnStartupFailure(process));
