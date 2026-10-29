import { AccountFailure, type AccountRefusal } from '../accounts/account-failure.ts';
import type { InstallationUsage, Usage } from '../accounts/account-service.ts';
import { chargedFrom, freshBooks, startingPolicy, type Books, type Policy } from './account-books.ts';

export interface Registration {
  readonly installation: string;
  readonly org: string;
}

export type Revocation = 'key_rotated' | 'installation_revoked';

export type Answering =
  | 'signed'
  | 'by another key'
  | 'by an unknown key'
  | 'for another installation'
  | 'tampered'
  | 'of another version'
  | 'with more than it knows';

export interface WentBackwards {
  readonly installation: string;
  readonly licensed: number;
  readonly charged_through: number;
}

export interface Settings {
  readonly now: number;
  readonly up: boolean;
  readonly closed: AccountRefusal | undefined;
  readonly answering: Answering;
  readonly policy: Policy;
}

export interface Keeping {
  readonly settings: () => Settings;
  readonly changed: (change: Readonly<Partial<Settings>>) => void;
  readonly registered: (key: string) => Registration | undefined;
  readonly register: (key: string, registration: Registration) => void;
  readonly refusalOf: (key: string) => AccountFailure;
  readonly revoke: (key: string, because: Revocation | undefined) => void;
  readonly nameOf: (org: string) => string | undefined;
  readonly name: (org: string, name: string) => void;
  readonly booksOf: (org: string) => Books;
  readonly fund: (org: string, books: Partial<Books>) => void;
  readonly chargedThrough: (installation: string) => number;
  readonly charge: (registration: Registration, licensed: number, reporting: boolean) => void;
  readonly activated: (usage: InstallationUsage) => void;
  readonly reported: (usage: Usage) => void;
  readonly reportSent: () => void;
  readonly activations: () => readonly InstallationUsage[];
  readonly reports: () => readonly Usage[];
  readonly reportsSent: () => number;
  readonly wentBackwards: () => readonly WentBackwards[];
}

const unknownKey = new AccountFailure({
  status: 403,
  kind: 'license_invalid',
  detail: 'The key is unknown, was rotated away or its runtime was removed',
});

const revocations: Readonly<Record<Revocation, AccountFailure>> = {
  key_rotated: new AccountFailure({
    status: 403,
    kind: 'license_invalid',
    detail: 'The key was rotated',
    because: 'key_rotated',
  }),
  installation_revoked: new AccountFailure({
    status: 403,
    kind: 'license_invalid',
    detail: 'The runtime was removed from its org',
    because: 'installation_revoked',
  }),
};

interface Kept {
  readonly registrations: Map<string, Registration>;
  readonly revoked: Map<string, AccountFailure>;
  readonly names: Map<string, string>;
  readonly books: Map<string, Books>;
  readonly charged: Map<string, number>;
}

function freshKept(): Kept {
  return {
    registrations: new Map(),
    revoked: new Map(),
    names: new Map(),
    books: new Map(),
    charged: new Map(),
  };
}

function settingsKept(): Pick<Keeping, 'settings' | 'changed'> {
  const settings: { current: Settings } = {
    current: {
      now: Date.parse('2026-10-27T12:00:00.000Z'),
      up: true,
      closed: undefined,
      answering: 'signed',
      policy: startingPolicy,
    },
  };
  return {
    settings: () => settings.current,
    changed: (change) => {
      settings.current = { ...settings.current, ...change };
    },
  };
}

function recordsKept() {
  const kept = { activations: new Array<InstallationUsage>(), reports: new Array<Usage>() };
  const backwards: WentBackwards[] = [];
  const sent = { reports: 0 };
  return {
    wentBack: (record: WentBackwards) => {
      backwards.push(record);
    },
    activated: (usage: InstallationUsage) => {
      kept.activations.push(usage);
    },
    reported: (usage: Usage) => {
      kept.reports.push(usage);
    },
    reportSent: () => {
      sent.reports += 1;
    },
    activations: () => [...kept.activations],
    reports: () => [...kept.reports],
    reportsSent: () => sent.reports,
    wentBackwards: () => [...backwards],
  };
}

export function accountKeeping(): Keeping {
  const kept = freshKept();
  const booksOf = (org: string): Books => kept.books.get(org) ?? freshBooks;
  const chargedThrough = (installation: string): number => kept.charged.get(installation) ?? 0;
  const { wentBack, ...records } = recordsKept();
  return {
    ...settingsKept(),
    ...records,
    registered: (key) => kept.registrations.get(key),
    register: (key, registration) => {
      kept.registrations.set(key, registration);
    },
    refusalOf: (key) => kept.revoked.get(key) ?? unknownKey,
    revoke: (key, because) => {
      kept.registrations.delete(key);
      if (because !== undefined) kept.revoked.set(key, revocations[because]);
    },
    nameOf: (org) => kept.names.get(org),
    name: (org, name) => {
      kept.names.set(org, name);
    },
    booksOf,
    fund: (org, books) => {
      kept.books.set(org, { ...booksOf(org), ...books });
    },
    chargedThrough,
    charge: ({ installation, org }, licensed, reporting) => {
      const through = chargedThrough(installation);
      if (licensed < through) {
        if (reporting) wentBack({ installation, licensed, charged_through: through });
        return;
      }
      kept.books.set(org, chargedFrom(booksOf(org), licensed - through));
      kept.charged.set(installation, licensed);
    },
  };
}
