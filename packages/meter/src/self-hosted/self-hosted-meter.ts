import { licenseClientOn } from '../license-client/license-client.ts';
import type { LicenseClientOptions } from '../license-client/records.ts';
import { openLicenseServices } from '../license-client/services.ts';
import { reportMaintenance } from '../maintenance/reporting.ts';
import { openOfflineCapacity } from '../offline-capacity/offline-capacity.ts';
import { openOfflineReporter } from '../offline-reports/offline-reporter.ts';
import { openOfflineMeter } from '../offline-reservations/offline-meter.ts';
import { capacityLicenseClient } from './licensed-capacity.ts';
import { maintainSelfHosted } from './maintenance.ts';
import type { SelfHostedMeter } from './records.ts';

export async function openSelfHostedMeter(options: LicenseClientOptions): Promise<SelfHostedMeter> {
  const captured = { ...options, clock: { ...options.clock } };
  const services = await openLicenseServices(captured);
  const accounting = {
    connection: services.connection,
    clock: services.clock,
    licenses: services.state,
    trust: services.trust,
  };
  const capacity = await openOfflineCapacity(accounting);
  const { clusterId, installationKeyDigest, publicKey } = services.installation;
  const license = capacityLicenseClient(
    services.connection,
    licenseClientOn(services, captured.clock.monotonicTime),
    capacity,
  );
  const reporting = await openOfflineReporter({
    connection: services.connection,
    installation: services.installation,
    authority: services.trust,
    fetch: captured.fetch,
  });
  const report = reportMaintenance(services.connection, reporting, captured.clock.monotonicTime);
  return {
    time: services.clock.read,
    installation: { clusterId, installationKeyDigest, publicKey: { ...publicKey } },
    license,
    capacity: capacity.snapshot,
    accounting: await openOfflineMeter(accounting),
    reporting,
    maintain: () => maintainSelfHosted(license.poll, report),
  };
}
