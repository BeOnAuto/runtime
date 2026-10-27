import { openLicenseClock } from '../clock/license-clock.ts';
import { openInstallation } from '../installation/open-installation.ts';
import { openLicenseState } from '../license-state/license-state.ts';
import { licenseProtocol } from '../licensing/protocol.ts';
import type { ClientServices, LicenseClientOptions } from './records.ts';

export async function openLicenseServices(options: LicenseClientOptions): Promise<ClientServices> {
  const captured = { ...options };
  const trust = { ...captured.trust, keys: captured.trust.keys.map((key) => ({ ...key })) };
  const samples = { ...captured.clock };
  const installation = await openInstallation(captured);
  const clock = await openLicenseClock(captured.connection, samples);
  const state = await openLicenseState({ connection: captured.connection, installation, trust });
  return {
    connection: captured.connection,
    installation,
    trust,
    clock,
    state,
    protocol: licenseProtocol({ trust, installation, fetch: captured.fetch, monotonicTime: samples.monotonicTime }),
  };
}
