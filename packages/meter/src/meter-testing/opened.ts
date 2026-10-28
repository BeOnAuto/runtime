import { onTestFinished } from 'vitest';

import { tamperingOn, type LedgerAt } from '../testing/ledgers.ts';
import { meteredOn, type Metered, type MeteredOptions } from '../testing/metered.ts';
import { runOf } from '../testing/runs.ts';

export type LedgerOf = () => Promise<LedgerAt>;

export async function opened(ledgerOf: LedgerOf, options: MeteredOptions = {}) {
  const at = await ledgerOf();
  onTestFinished(() => at.remove());
  const metered = await meteredOn(at, options);
  onTestFinished(() => metered.dispose());
  return { at, metered, tampering: tamperingOn(at) };
}

export async function replicaOf(at: LedgerAt, options: MeteredOptions = {}): Promise<Metered> {
  const replica = await meteredOn(at, options);
  onTestFinished(() => replica.dispose());
  return replica;
}

export async function restartedAfter(
  metered: Metered,
  meanwhile: () => Promise<void>,
  options: MeteredOptions = {},
): Promise<Metered> {
  const restarted = await metered.restarted(options, meanwhile);
  onTestFinished(() => restarted.dispose());
  return restarted;
}

export function restartedOf(metered: Metered, options: MeteredOptions = {}): Promise<Metered> {
  return restartedAfter(metered, () => Promise.resolve(), options);
}

export async function startedOnceAdmitted(metered: Metered, run: string, playbook = 'alpha', org = 'acme') {
  const answer = await metered.admitted(runOf(run, playbook, org));
  await metered.started(run, playbook, org);
  return answer.kind;
}

export async function checkpointOf(metered: Metered) {
  return (await metered.state()).checkpoint;
}

export async function actionsOf(metered: Metered): Promise<number> {
  return Number((await metered.state()).checkpoint?.actions);
}

const allocatedInstallation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f';

export async function allocatedOn(ledgerOf: LedgerOf, credits: number, withAKey = true) {
  const { metered, ...rest } = await opened(ledgerOf);
  const key = metered.account.keyFor(allocatedInstallation);
  const allocation = metered.account.allocationFor(allocatedInstallation, credits);
  const given = await restartedOf(metered, withAKey ? { key } : {});
  await given.allocated(allocation);
  return { ...rest, metered: given, key, allocation };
}

export const licensedInstallation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export async function licensedOn(ledgerOf: LedgerOf) {
  const { metered, ...rest } = await opened(ledgerOf);
  const key = metered.account.keyFor(licensedInstallation);
  const licensed = await restartedOf(metered, { key });
  return { ...rest, metered: licensed, key };
}
