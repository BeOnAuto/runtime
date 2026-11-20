import { writeFileSync } from 'node:fs';

import { makeAppRuntime } from '@on.auto/api';
import type { Environment } from '@on.auto/config';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';

import { dispatcherServicesOver } from '../../composition/application-layer.ts';
import { ledgerOpenedAtStart, signInOpened } from '../../composition/ledger-store.ts';
import { workerPool } from '../../composition/served-computation.ts';
import { shippedRoots } from '../../server-options/shipped-roots.ts';
import { readSettingsOf } from '../settings/shipped-settings.ts';

export type KeptBySignIn = Awaited<ReturnType<typeof signInOpened>>;

export const shippedFilesOfTheServer = shippedFilesOnDisk(shippedRoots);

export async function aLedgerAServerKeptAt(
  environment: Environment & { readonly LEDGER_FILE: string },
  keep: (signIn: KeptBySignIn) => Promise<unknown>,
): Promise<void> {
  writeFileSync(environment.LEDGER_FILE, '', { flag: 'a' });
  const settings = readSettingsOf(environment);
  const { made, ledgerLayer } = await ledgerOpenedAtStart(settings, {
    programPoolOf: workerPool,
    shippedFiles: shippedFilesOfTheServer,
  });
  const runtime = await makeAppRuntime(made.computation.closedLastOf(dispatcherServicesOver(ledgerLayer)));
  try {
    await keep(await signInOpened(runtime, settings));
  } finally {
    await runtime.dispose();
  }
}
