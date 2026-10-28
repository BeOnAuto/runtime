import { shownOrgName, type LicenseState, type LicenseStatus, type OfflineCredits } from '@on.auto/meter';
import { Function, Option } from 'effect';

export function dayOf(moment: string): string {
  return moment.slice(0, 10);
}

export function offlineCreditsNotice({ credits, spent, usable_until: usableUntil }: OfflineCredits): string {
  return `Offline credits: ${spent} of ${credits} used, usable until ${dayOf(usableUntil)}`;
}

export function licensedToOf(org: string, orgName: string | null | undefined): string {
  return shownOrgName(orgName) ?? org;
}

function licensedNotice({ org, org_name: orgName, plan }: LicenseStatus): string | undefined {
  return Option.getOrUndefined(
    Option.zipWith(
      Option.fromNullishOr(org),
      Option.fromNullishOr(plan),
      (to, on) => `Licensed to ${licensedToOf(to, orgName)} (${on} plan)`,
    ),
  );
}

const noticesByState: Readonly<Record<LicenseState, (status: LicenseStatus) => string | undefined>> = {
  unregistered: ({ free_runs: { used, of } }) => `${used} of ${of} free runs used, then a free key from Studio`,
  licensed: licensedNotice,
  offline: ({ offline }) => Option.getOrUndefined(Option.map(Option.fromNullishOr(offline), offlineCreditsNotice)),
  invalid: Function.constUndefined,
};

export function licenseNoticeOf(status: LicenseStatus): string | undefined {
  return status.fault ?? noticesByState[status.state](status);
}
