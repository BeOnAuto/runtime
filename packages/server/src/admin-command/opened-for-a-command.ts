import { makeAppRuntime, type AppRuntime } from '@on.auto/api';
import { ledgerLayout, type ConnectionPorts } from '@on.auto/ledger';
import type { Ledger } from '@on.auto/operations';
import { Layer } from 'effect';

import { dispatcherServicesOver } from '../composition/application-layer.ts';
import { ledgerOpenedAtStart, signInOpened, type LedgerAtStart } from '../composition/ledger-store.ts';
import { workerPool } from '../composition/served-computation.ts';
import { serverLogs } from '../logging/logging.ts';
import type { Said } from './admin-words.ts';
import { ledgerFoundIn, ledgerNotOpenedFor } from './ledger-reached.ts';

export const byACommand = 'command';

type Settings = Parameters<typeof ledgerOpenedAtStart>[0];

type ShippedFiles = Parameters<typeof ledgerOpenedAtStart>[1]['shippedFiles'];

type SignIn = Awaited<ReturnType<typeof signInOpened>>;

export interface Opened {
  readonly settings: Settings;
  readonly runtime: AppRuntime<Ledger>;
  readonly database: LedgerAtStart['database'];
  readonly connection: ConnectionPorts;
  readonly signIn: Pick<SignIn, 'providerRows' | 'peopleRows' | 'clientRegistrationsWith'>;
}

export type OpeningOf<Asked> = (use: (opened: Asked) => Promise<Said>) => Promise<Said>;

export type Opening = OpeningOf<Opened>;

async function openedWith(settings: Settings, shippedFiles: ShippedFiles): Promise<Opened> {
  ledgerFoundIn(settings.ledger);
  const { database, made, ledgerLayer } = await ledgerOpenedAtStart(settings, {
    programPoolOf: workerPool,
    shippedFiles,
    floor: ledgerLayout,
  });
  const services = made.computation.closedLastOf(dispatcherServicesOver(ledgerLayer));
  const runtime = await makeAppRuntime(services.pipe(Layer.provideMerge(serverLogs(settings))));
  try {
    const signIn = await signInOpened(runtime, settings);
    return { settings, runtime, database, connection: signIn.connection, signIn };
  } catch (failure) {
    await runtime.dispose();
    throw failure;
  }
}

export async function withTheLedgerOpened(
  settings: Settings,
  shippedFiles: ShippedFiles,
  use: (opened: Opened) => Promise<Said>,
): Promise<Said> {
  const opened = await openedWith(settings, shippedFiles).catch((failure: unknown) =>
    ledgerNotOpenedFor(failure, settings.ledger),
  );
  if ('said' in opened) {
    return opened;
  }
  try {
    return await use(opened);
  } finally {
    await opened.runtime.dispose();
  }
}
