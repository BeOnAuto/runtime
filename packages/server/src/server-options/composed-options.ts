import type { DispatcherServices } from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';

import { exitDeadlineMs, shutdownTimeoutMs } from '../lifecycle/shutdown.ts';
import type { ServerOptions } from './server-options.ts';

export type ComposedServerOptions = ServerOptions<DispatcherServices>;

export function serverOptionsComposing<R>(composed: ServerOptions<R>['composed']): ServerOptions<R> {
  return { composed, shutdownTimeoutMs, exitDeadlineMs, shippedFiles: shippedFilesOnDisk };
}
