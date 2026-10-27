import type { LedgerChores, LedgerConnection } from '@on.auto/ledger';
import type { RuntimeLicense } from '@on.auto/meter';
import type { DispatcherServices } from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';

import { exitDeadlineMs, shutdownTimeoutMs } from '../lifecycle/shutdown.ts';
import type { ServerOptions } from './server-options.ts';
import { shippedRoots } from './shipped-roots.ts';

export type ServerServices = DispatcherServices | LedgerConnection | LedgerChores | RuntimeLicense;

export type ComposedServerOptions = ServerOptions<ServerServices>;

export function serverOptionsComposing<R>(composed: ServerOptions<R>['composed']): ServerOptions<R> {
  return { composed, shutdownTimeoutMs, exitDeadlineMs, shippedFiles: shippedFilesOnDisk(shippedRoots) };
}
