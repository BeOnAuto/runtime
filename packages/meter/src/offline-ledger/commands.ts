import type { ConnectionPorts } from '@on.auto/ledger';

import { existingOfflineCommand } from './reading.ts';
import type { OfflineCommand, OfflineMutation, OfflineResult } from './records.ts';
import { writeOfflineMutation } from './writing.ts';

interface CommandOperation {
  readonly connection: ConnectionPorts;
  readonly command: OfflineCommand;
  readonly mutation: () => Promise<OfflineMutation>;
}

async function attemptCommand(operation: CommandOperation, attempts: number): Promise<OfflineResult> {
  if (attempts === 0) throw new Error('offline_accounting_contended');
  const { connection, command } = operation;
  const previous = await existingOfflineCommand(connection, command);
  if (previous !== undefined) return { ...previous, status: 'existing' };
  try {
    const mutation = await operation.mutation();
    if (await writeOfflineMutation(connection, command, mutation))
      return {
        commandId: command.id,
        reservationId: command.reservationId,
        allocationId: mutation.allocationId,
        revision: mutation.revision + 1,
        kind: command.kind,
        units: mutation.units,
        status: 'applied',
      };
  } catch (error) {
    const recovered = await existingOfflineCommand(connection, command);
    if (recovered !== undefined) return { ...recovered, status: 'existing' };
    throw error;
  }
  return attemptCommand(operation, attempts - 1);
}

export function performOfflineCommand(operation: CommandOperation): Promise<OfflineResult> {
  return attemptCommand(operation, 128);
}
