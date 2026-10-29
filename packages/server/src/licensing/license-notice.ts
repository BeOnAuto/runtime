import type { OfflineCredits } from '@on.auto/meter';

function dayOf(moment: string): string {
  return moment.slice(0, 10);
}

export function offlineCreditsNotice({ credits, spent, usable_until: usableUntil }: OfflineCredits): string {
  return `Offline credits: ${spent} of ${credits} used, usable until ${dayOf(usableUntil)}`;
}
