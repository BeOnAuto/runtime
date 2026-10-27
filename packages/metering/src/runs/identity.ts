export interface RunIdentity {
  readonly accountId: string;
  readonly deploymentId: string;
  readonly playbookId: string;
  readonly runId: string;
}

export type ChargeKind = 'platform' | 'development';

export async function accountingDigest(parts: readonly string[]): Promise<string> {
  if (parts.some((part) => part.length === 0 || part.length > 512 || part.trim() !== part)) {
    throw new RangeError('Accounting identities require non-empty, bounded identifiers');
  }
  const data = new TextEncoder().encode(JSON.stringify(parts));
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function runChargeId(identity: RunIdentity, kind: ChargeKind): Promise<string> {
  const { accountId, deploymentId, playbookId, runId } = identity;
  return `charge_${await accountingDigest(['auto.run.v1', accountId, deploymentId, playbookId, runId, kind])}`;
}

export async function resourceReceiptId(accountId: string, providerId: string, requestId: string): Promise<string> {
  return `resource_${await accountingDigest(['auto.resource.v1', accountId, providerId, requestId])}`;
}
