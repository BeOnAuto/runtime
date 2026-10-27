import type { CurrentLicense, LicenseHead } from '../license-state/records.ts';
import { authorizationRefused, finishLicenseExchange, repairLicenseTime } from './completion.ts';
import { keepPendingExchange, readPendingExchange } from './pending.ts';
import type { ClientServices, PendingExchange } from './records.ts';

type ExchangeIntent = { readonly activationKey: string } | { readonly installationId: string };

async function finishOrRenew(services: ClientServices, pending: PendingExchange): Promise<CurrentLicense> {
  try {
    return await finishLicenseExchange(services, pending);
  } catch (error) {
    if (!(error instanceof errors.JWTExpired)) throw error;
  }
  const before = await services.state.head();
  const challenge = await proposedExchange(services, { installationId: pending.challenge.installationId }, before);
  const replacement = await keepPendingExchange(
    services.connection,
    { expectedRevision: before.revision, challenge },
    pending.challenge.id,
  );
  return finishLicenseExchange(services, replacement);
}

async function proposedExchange(services: ClientServices, intent: ExchangeIntent, before: LicenseHead) {
  try {
    const requestId = crypto.randomUUID();
    return 'activationKey' in intent
      ? await services.protocol.activationChallenge(requestId, intent.activationKey)
      : await services.protocol.refreshChallenge(requestId, intent.installationId);
  } catch (error) {
    if ('installationId' in intent && authorizationRefused(error)) await services.state.refuse(before.revision);
    throw error;
  }
}

async function startExchange(
  services: ClientServices,
  intent: ExchangeIntent,
  before: LicenseHead,
): Promise<CurrentLicense> {
  const challenge = await proposedExchange(services, intent, before);
  const pending = await keepPendingExchange(services.connection, { expectedRevision: before.revision, challenge });
  if ('activationKey' in intent && pending.challenge.licenseId !== challenge.licenseId)
    throw new Error('license_exchange_in_progress');
  return finishOrRenew(services, pending);
}

export async function activateLicense(services: ClientServices, activationKey: string): Promise<CurrentLicense> {
  await repairLicenseTime(services);
  return startExchange(services, { activationKey }, await services.state.head());
}

export async function resumeLicenseExchange(services: ClientServices): Promise<CurrentLicense | undefined> {
  const pending = await readPendingExchange(services.connection);
  if (pending === undefined) return undefined;
  await repairLicenseTime(services);
  return finishOrRenew(services, pending);
}

export async function refreshLicense(services: ClientServices): Promise<CurrentLicense> {
  const pending = await readPendingExchange(services.connection);
  if (pending !== undefined) {
    await repairLicenseTime(services);
    return finishOrRenew(services, pending);
  }
  const before = await services.state.head();
  if (before.installationId === null) throw new Error('license_required');
  await repairLicenseTime(services);
  return startExchange(services, { installationId: before.installationId }, before);
}
import { errors } from 'jose';
