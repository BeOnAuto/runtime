import { activateLicense, refreshLicense, resumeLicenseExchange } from './exchanges.ts';
import { licenseMaintenance } from './maintenance.ts';
import type { ClientServices, LicenseClient, LicenseClientOptions } from './records.ts';
import { openLicenseServices } from './services.ts';

export async function openLicenseClient(options: LicenseClientOptions): Promise<LicenseClient> {
  const monotonicTime = options.clock.monotonicTime;
  return licenseClientOn(await openLicenseServices(options), monotonicTime);
}

export function licenseClientOn(services: ClientServices, monotonicTime: () => number): LicenseClient {
  const { state, clock } = services;
  return {
    head: state.head,
    current: async () => state.current(await clock.read()),
    activate: (activationKey) => activateLicense(services, activationKey),
    refresh: () => refreshLicense(services),
    resume: () => resumeLicenseExchange(services),
    poll: licenseMaintenance(services, monotonicTime),
  };
}
