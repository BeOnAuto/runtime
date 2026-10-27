import { testSigners } from '@on.auto/meter/testing';
import { onTestFinished } from 'vitest';

import { compositionRootWith } from '../../composition/composition-root.ts';
import { loggedModelAccess } from '../../composition/served-reasoning.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { localControlOf, restartMarkIn } from '../../local-runtime/local-control.ts';
import { runsInFlight } from '../../local-runtime/runs-in-flight.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';
import { loopbackSettingsOver } from '../servers/reasoning-server.ts';
import { accountsServed, type Accounts } from './licensed-server.ts';

export interface ControlledServer {
  readonly port: number;
  readonly accounts: Accounts;
}

function startedInATerminal(home: string) {
  return localControlOf(
    {
      version: '0.9.1',
      pid: 4242,
      instance: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      startedAt: new Date('2026-10-14T09:41:07.000Z'),
      directory: home,
      home,
      startedBy: 'terminal',
      port: undefined,
    },
    runsInFlight(),
    restartMarkIn(home),
  );
}

export async function controlledLicensedServer(home: string): Promise<ControlledServer> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const accounts = await accountsServed();
  const composition = compositionRootWith(loggedModelAccess, { signers: testSigners });
  const settings = { ...loopbackSettingsOver(ledger), ACCOUNTS_ORIGIN: accounts.origin };
  const server = await startServer(settings, { ...composition, localServingIn: startedInATerminal(home).servingIn });
  onTestFinished(() => server.stop());
  return { port: server.port, accounts };
}
