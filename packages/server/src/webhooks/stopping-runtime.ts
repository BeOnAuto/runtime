import type { HeldSecret, SigningKeys } from '@on.auto/api';
import type { Cancelled } from '@on.auto/operations';
import type { EventDestination } from '@on.auto/providers';

export function keysUnlessStopped(ran: Readonly<SigningKeys> | Cancelled | undefined): SigningKeys | undefined {
  return ran === undefined || 'status' in ran ? undefined : ran;
}

export function holderUnlessStopped(ran: string | Cancelled): string {
  return typeof ran === 'string' ? ran : '';
}

export function destinationUnlessStopped(ran: EventDestination | Cancelled | undefined): EventDestination | undefined {
  return ran === undefined || 'status' in ran ? undefined : ran;
}

export function secretsUnlessStopped(ran: readonly HeldSecret[] | Cancelled): readonly HeldSecret[] {
  return 'status' in ran ? [] : ran;
}

export type IntakeDecision = 'decided' | { readonly undecided: string };

export function decidedUnlessStopped(ran: IntakeDecision | Cancelled): void {
  if (ran === 'decided') {
    return;
  }
  const because = 'undecided' in ran ? ran.undecided : 'stopped';
  throw new Error(`The intake could not decide on the event a delivery carries: ${because}`);
}
