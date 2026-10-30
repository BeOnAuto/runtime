import type { RegisterRoutes } from '@on.auto/api';

import { exitOnStartupFailure, runServer } from '../../lifecycle/run-server.ts';
import { stopInsistedBy, stopRequestedBy } from '../../lifecycle/stop-request.ts';
import { servedBy } from '../../server-options/server-options.ts';
import { optionsServing } from './serving-options.ts';

const selfCaused = new Error('an error whose cause is itself');
selfCaused.cause = selfCaused;

const selfCausedRoute: RegisterRoutes = (routes) => {
  routes.add('GET', '/self-caused', () => {
    throw selfCaused;
  });
};

await runServer(
  process,
  optionsServing(() => servedBy([selfCausedRoute])),
  stopRequestedBy(process),
  stopInsistedBy(process),
).catch(exitOnStartupFailure(process));
