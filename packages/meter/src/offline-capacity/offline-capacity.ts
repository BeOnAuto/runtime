import { prepareMeter } from '../database/schema.ts';
import { capacityInstaller } from './installation.ts';
import type { CapacityOptions, OfflineCapacity } from './records.ts';
import { capacitySnapshot } from './snapshot.ts';

export async function openOfflineCapacity(options: CapacityOptions): Promise<OfflineCapacity> {
  const captured = { ...options };
  const install = capacityInstaller(captured);
  await prepareMeter(captured.connection);
  return { install, snapshot: () => capacitySnapshot(captured.connection) };
}
