import { openLicenseClock } from '../clock/license-clock.ts';
import { openInstallation } from '../installation/open-installation.ts';
import { openLicenseState } from '../license-state/license-state.ts';
import { licenseProtocol } from '../licensing/protocol.ts';
import { activateLicense, refreshLicense, resumeLicenseExchange } from './exchanges.ts';
import { licenseMaintenance } from './maintenance.ts';
import type { ClientServices, LicenseClient, LicenseClientOptions } from './records.ts';

export async function openLicenseClient(options: LicenseClientOptions): Promise<LicenseClient> {
  const trust = { ...options.trust, keys: options.trust.keys.map((key) => ({ ...key })) };
  const installation = await openInstallation(options);
  const clock = await openLicenseClock(options.connection, options.clock);
  const state = await openLicenseState({ connection: options.connection, installation, trust });
  const services: ClientServices = {
    connection: options.connection,
    installation,
    trust,
    clock,
    state,
    protocol: licenseProtocol({
      trust,
      installation,
      fetch: options.fetch,
      monotonicTime: options.clock.monotonicTime,
    }),
  };
  return {
    head: state.head,
    current: async () => state.current(await clock.read()),
    activate: (activationKey) => activateLicense(services, activationKey),
    refresh: () => refreshLicense(services),
    resume: () => resumeLicenseExchange(services),
    poll: licenseMaintenance(services, options.clock.monotonicTime),
  };
}
