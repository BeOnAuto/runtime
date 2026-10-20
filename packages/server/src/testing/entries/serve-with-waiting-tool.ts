import type { DispatcherServices } from '@on.auto/operations';
import { playbookOperations } from '@on.auto/playbooks';

import { compositionRoot } from '../../composition/composition-root.ts';
import { routesServing } from '../../composition/served-routes.ts';
import { keyInHandOf } from '../../database/secrets-keys.ts';
import { servedBy } from '../../lifecycle/lifecycle.ts';
import { exitOnStartupFailure, runServer } from '../../lifecycle/run-server.ts';
import { stopInsistedBy, stopRequestedBy } from '../../lifecycle/stop-request.ts';
import { shortShutdownTimeoutMs } from '../processes/shutdown-timeouts.ts';
import { waitForeverAnnouncedIn } from './calls-in-flight.ts';

await runServer<DispatcherServices>(
  process,
  {
    ...compositionRoot,
    composed: (settings, telemetry) => ({
      ...compositionRoot.composed(settings, telemetry),
      serve: (runtime) =>
        servedBy(
          routesServing([...playbookOperations, waitForeverAnnouncedIn(process.env)], {
            identityIssuer: settings.identityIssuer,
            retryStateKeys: { current: keyInHandOf({ from: 'start' }) },
          })(runtime),
        ),
    }),
    shutdownTimeoutMs: shortShutdownTimeoutMs,
  },
  stopRequestedBy(process),
  stopInsistedBy(process),
).catch(exitOnStartupFailure(process));
