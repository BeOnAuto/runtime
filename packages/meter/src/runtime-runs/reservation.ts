import type { RunDispatch } from '@on.auto/definitions';
import { runChargeId, runQuote, type QuoteContext, type WorkBound } from '@on.auto/metering';

import type { OfflineReservation } from '../offline-reservations/records.ts';
import { bindingOf, canonicalRunId, capabilityOf, playbookIdentity } from './binding.ts';
import type { RuntimeRunOptions } from './records.ts';

const singleRun: WorkBound = { type: 'run', resources: [], developmentUnits: 0n };
const quoteMilliseconds = 60_000;

interface PreparedRun {
  readonly id: string;
  readonly capability: 'computation' | 'recall';
  readonly context: QuoteContext;
}

async function preparedRun(options: RuntimeRunOptions, run: RunDispatch): Promise<PreparedRun> {
  const capability = capabilityOf(run);
  if ((await options.meter.license.head()).state === 'unlicensed') throw new Error('license_required');
  const { license } = await options.meter.license.current();
  const time = await options.meter.time();
  if (time.onlineRequired) throw new Error('license_clock_untrusted');
  const identity = {
    accountId: license.accountId,
    deploymentId: license.installationId,
    playbookId: playbookIdentity(run),
    runId: canonicalRunId(run.runId),
  };
  return {
    id: `reservation:${await runChargeId(identity, 'platform')}`,
    capability,
    context: {
      run: identity,
      ...(await bindingOf(run, options.limits[capability])),
      expiresAt: time.now + quoteMilliseconds,
    },
  };
}

function checkedReservation(reservation: OfflineReservation, prepared: PreparedRun): OfflineReservation {
  const { context, capability } = prepared;
  if (
    reservation.context.definitionVersion !== context.definitionVersion ||
    reservation.context.inputDigest !== context.inputDigest ||
    reservation.context.limitsDigest !== context.limitsDigest ||
    reservation.maximumUnits !== 1_000_000n ||
    reservation.capabilities.length !== 1 ||
    reservation.capabilities[0] !== capability
  )
    throw new Error('runtime_quote_mismatch');
  return reservation;
}

async function reserved(options: RuntimeRunOptions, prepared: PreparedRun): Promise<OfflineReservation> {
  const previous = await options.meter.accounting.reservation(prepared.id);
  if (previous !== undefined) return checkedReservation(previous, prepared);
  try {
    await options.meter.accounting.reserve({
      context: prepared.context,
      quote: await runQuote(prepared.context, singleRun, 0),
      plan: singleRun,
      capabilities: [prepared.capability],
    });
  } catch (error) {
    const recovered = await options.meter.accounting.reservation(prepared.id);
    if (recovered !== undefined) return checkedReservation(recovered, prepared);
    throw error;
  }
  const reservation = await options.meter.accounting.reservation(prepared.id);
  if (reservation === undefined) throw new Error('runtime_reservation_missing');
  return checkedReservation(reservation, prepared);
}

export async function admittedReservation(options: RuntimeRunOptions, run: RunDispatch) {
  const prepared = await preparedRun(options, run);
  return { reservation: await reserved(options, prepared), capability: prepared.capability };
}
