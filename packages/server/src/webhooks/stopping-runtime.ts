import type { SigningKeys } from '@on.auto/api';
import type { Cancelled } from '@on.auto/operations';
import type { EventDestination } from '@on.auto/providers';
import type { Redacted } from 'effect';

export function keysUnlessStopped(ran: Readonly<SigningKeys> | Cancelled | undefined): SigningKeys | undefined {
  return ran === undefined || 'status' in ran ? undefined : ran;
}

export function holderUnlessStopped(ran: string | Cancelled): string {
  return typeof ran === 'string' ? ran : '';
}

export function destinationUnlessStopped(ran: EventDestination | Cancelled | undefined): EventDestination | undefined {
  return ran === undefined || 'status' in ran ? undefined : ran;
}

export function secretsUnlessStopped(ran: readonly Redacted.Redacted[] | Cancelled): readonly Redacted.Redacted[] {
  return 'status' in ran ? [] : ran;
}
