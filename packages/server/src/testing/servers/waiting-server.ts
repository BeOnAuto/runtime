import { waitForeverAnnouncing } from '@on.auto/api/testing';
import type { DispatcherServices } from '@on.auto/operations';
import { playbookOperations } from '@on.auto/playbooks';

import { compositionRoot } from '../../composition/composition-root.ts';
import { routesServing } from '../../composition/served-routes.ts';
import { servedBy, startServer } from '../../lifecycle/lifecycle.ts';
import { keyInHandOf } from '../../secrets/secrets-keys.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';
import { loopbackSettingsOver } from './reasoning-server.ts';

export interface WaitingServer {
  readonly port: number;
  readonly calling: Promise<void>;
  readonly stop: () => Promise<void>;
}

const holdsItsCallsForMs = 200;

export async function servingAToolThatWaits(): Promise<WaitingServer> {
  const ledger = temporaryLedger();
  const calling = Promise.withResolvers<void>();
  const server = await startServer<DispatcherServices>(loopbackSettingsOver(ledger), {
    ...compositionRoot,
    composed: (settings, telemetry) => ({
      ...compositionRoot.composed(settings, telemetry),
      serve: (runtime) =>
        servedBy(
          routesServing([...playbookOperations, waitForeverAnnouncing(calling.resolve)], {
            identityIssuer: settings.identityIssuer,
            retryStateKeys: { current: keyInHandOf({ from: 'start' }) },
          })(runtime),
        ),
    }),
    shutdownTimeoutMs: holdsItsCallsForMs,
  });
  return {
    port: server.port,
    calling: calling.promise,
    stop: async () => {
      await server.stop();
      ledger.remove();
    },
  };
}
