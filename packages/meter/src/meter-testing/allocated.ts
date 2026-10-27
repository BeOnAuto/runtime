import { opened, restartedOf, type LedgerOf } from './opened.ts';

const installation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7f';

export async function allocatedOn(ledgerOf: LedgerOf, credits: number, withAKey = true) {
  const { metered, ...rest } = await opened(ledgerOf);
  const key = metered.account.keyFor(installation);
  const allocation = metered.account.allocationFor(installation, credits);
  const given = await restartedOf(metered, withAKey ? { key } : {});
  await given.allocated(allocation);
  return { ...rest, metered: given, key, allocation };
}
