import { listenOnLoopback } from '../listening.ts';
import { acmeAdmin, acmeAdminActing, operationServer, type OperationServerOptions } from '../operation-server.ts';
import { servedSurfaceAt, type FirstCall, type Reading, type ServedSurface } from './served-surface.ts';

export function readingAt(origin: string, firstCalls: readonly FirstCall[] = []): Reading {
  return {
    origin,
    headers: { authorization: `Bearer ${acmeAdmin.key}` },
    org: 'acme',
    playbook: 'alpha',
    actingAs: acmeAdminActing,
    firstCalls,
  };
}

export async function surfaceServedBy(
  options: OperationServerOptions,
  firstCalls?: readonly FirstCall[],
): Promise<ServedSurface> {
  const server = await operationServer(options);
  const listening = await listenOnLoopback(server.handler);
  try {
    return await servedSurfaceAt(readingAt(listening.origin, firstCalls));
  } finally {
    await listening.close();
    await server.runtime.dispose();
  }
}
