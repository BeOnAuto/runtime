import { onTestFinished } from 'vitest';

import type { MeterOptions } from '../admission/ledger-meter.ts';
import { tamperingOn, type LedgerAt } from './ledgers.ts';
import { meteredOn, runOf, type Metered } from './metered.ts';

export type LedgerOf = () => Promise<LedgerAt>;

export async function opened(ledgerOf: LedgerOf, options: Partial<MeterOptions> = {}) {
  const at = await ledgerOf();
  onTestFinished(() => at.remove());
  const metered = await meteredOn(at, options);
  onTestFinished(() => metered.dispose());
  return { at, metered, tampering: tamperingOn(at) };
}

export async function replicaOf(at: LedgerAt, options: Partial<MeterOptions> = {}): Promise<Metered> {
  const replica = await meteredOn(at, options);
  onTestFinished(() => replica.dispose());
  return replica;
}

export async function restartedOf(metered: Metered, options: Partial<MeterOptions> = {}): Promise<Metered> {
  const restarted = await metered.restarted(options);
  onTestFinished(() => restarted.dispose());
  return restarted;
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
