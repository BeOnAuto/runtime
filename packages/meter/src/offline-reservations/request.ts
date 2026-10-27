import {
  assertOfflineRunIdentity,
  assertQuoteMatches,
  offlineCheckpoint,
  runChargeId,
  type QuoteContext,
} from '@on.auto/metering';
import { Schema } from 'effect';

import type { OfflineCommand } from '../offline-ledger/records.ts';
import type { OfflineReserveRequest } from './records.ts';

export const capabilityValues = Schema.Literals([
  'reasoning',
  'interaction',
  'prediction',
  'recall',
  'computation',
  'coordination',
]);
export const readCapabilities = Schema.decodeUnknownSync(Schema.Array(capabilityValues));

export function quoteContextJson(context: QuoteContext): string {
  const { run, definitionVersion, inputDigest, limitsDigest, expiresAt } = context;
  return JSON.stringify({
    run: { accountId: run.accountId, deploymentId: run.deploymentId, playbookId: run.playbookId, runId: run.runId },
    definitionVersion,
    inputDigest,
    limitsDigest,
    expiresAt,
  });
}

export async function reservationCommand(request: OfflineReserveRequest): Promise<OfflineCommand> {
  assertOfflineRunIdentity(request.context.run);
  const capabilities = readCapabilities(request.capabilities);
  if (capabilities.length === 0 || new Set(capabilities).size !== capabilities.length)
    throw new Error('offline_capabilities_invalid');
  await assertQuoteMatches(request.quote, request.context, request.plan, 0);
  const { maximum } = request.quote;
  if (maximum.resourceUnits !== 0n || maximum.developmentUnits !== 0n)
    throw new Error('offline_platform_capacity_only');
  if (maximum.platformUnits === 0n) throw new Error('offline_reservation_empty');
  const reservationId = `reservation:${await runChargeId(request.context.run, 'platform')}`;
  return {
    id: `reserve:${reservationId}`,
    reservationId,
    kind: 'reserve',
    payloadDigest: await offlineCheckpoint(
      JSON.stringify(['auto.local-reserve.v1', request.quote.id, capabilities.toSorted()]),
    ),
  };
}
