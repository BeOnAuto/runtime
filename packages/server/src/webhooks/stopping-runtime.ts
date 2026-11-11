import type { SigningKeys } from '@on.auto/api';
import type { Cancelled } from '@on.auto/operations';

export function keysUnlessStopped(ran: Readonly<SigningKeys> | Cancelled | undefined): SigningKeys | undefined {
  return ran === undefined || 'status' in ran ? undefined : ran;
}

export function holderUnlessStopped(ran: string | Cancelled): string {
  return typeof ran === 'string' ? ran : '';
}
