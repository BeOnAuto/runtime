import { randomUUID } from 'node:crypto';

import { Effect } from 'effect';

import { AccountFailure, unreachable } from '../accounts/account-failure.ts';
import type { AccountPorts, InstallationUsage, Usage } from '../accounts/account-service.ts';
import type { Signed } from '../licensing/signed-answers.ts';
import { spendableOf, standingOf, type Books, type Policy } from './account-books.ts';
import {
  accountKeeping,
  type Answering,
  type Keeping,
  type Registration,
  type Revocation,
  type WentBackwards,
} from './account-keeping.ts';
import { allocationFake, type AllocationFake } from './allocation-fake.ts';
import { signedByAnotherKey, signedByTheTestKey } from './test-signing.ts';

export type { Answering, Revocation, WentBackwards } from './account-keeping.ts';

interface ClosedAccount {
  readonly detail: string;
  readonly because?: string;
  readonly resolve_at?: string;
}

export interface AccountFake extends Omit<AllocationFake, 'ports'> {
  readonly ports: AccountPorts;
  readonly keyFor: (installation: string, org?: string) => string;
  readonly orgNamed: (org: string, name: string) => void;
  readonly grant: (org: string, features: readonly string[]) => void;
  readonly fund: (org: string, books: Partial<Books>) => void;
  readonly booksOf: (org: string) => Books;
  readonly policy: (policy: Partial<Policy>) => void;
  readonly revoke: (key: string, because?: Revocation) => void;
  readonly close: (closed: ClosedAccount) => void;
  readonly goDown: () => void;
  readonly comeBack: () => void;
  readonly answer: (how: Answering) => void;
  readonly at: (moment: string) => void;
  readonly chargedThrough: (installation: string) => number;
  readonly activations: () => readonly InstallationUsage[];
  readonly reports: () => readonly Usage[];
  readonly reportsSent: () => number;
  readonly wentBackwards: () => readonly WentBackwards[];
}

type Payload = Readonly<Record<string, unknown>>;

const dayMs = 86_400_000;

function tampered(signed: Signed): Signed {
  const text = `${Buffer.from(signed.payload, 'base64url').toString('utf8')} `;
  return { ...signed, payload: Buffer.from(text, 'utf8').toString('base64url') };
}

const answers: Readonly<Record<Answering, (payload: Payload) => Signed>> = {
  signed: (payload) => signedByTheTestKey(payload),
  'by another key': (payload) => signedByAnotherKey()(payload),
  'by an unknown key': (payload) => signedByAnotherKey('rogue-2026-10')(payload),
  'for another installation': (payload) => signedByTheTestKey({ ...payload, installation: 'another-installation' }),
  tampered: (payload) => tampered(signedByTheTestKey(payload)),
  'of another version': (payload) => signedByTheTestKey({ ...payload, v: 1, kind: 'entitlement' }),
  'with more than it knows': (payload) => signedByTheTestKey({ ...payload, seats: 5, region: 'eu' }),
};

function isoOf(keeping: Keeping, laterMs = 0): string {
  return new Date(keeping.settings().now + laterMs).toISOString();
}

function licenseOf(keeping: Keeping, { installation, org }: Registration, licensed: number): Signed {
  const books = keeping.booksOf(org);
  const chargedThrough = keeping.chargedThrough(installation);
  const name = keeping.nameOf(org);
  const features = keeping.featuresOf(org);
  const { policy, answering } = keeping.settings();
  return answers[answering]({
    v: 2,
    kind: 'license',
    installation,
    org,
    ...(name === undefined ? {} : { org_name: name }),
    plan: books.plan,
    policy: policy.version,
    issued_at: isoOf(keeping),
    warn_at: isoOf(keeping, policy.warn_after_days * dayMs),
    limit_at: isoOf(keeping, policy.limit_after_days * dayMs),
    charged_through: chargedThrough,
    admits_through: Math.max(chargedThrough, licensed) + spendableOf(books),
    standing: standingOf(books),
    credits: { available: books.available, owed: books.owed, overage_cap: books.overage_cap },
    fallback: { per_day: policy.per_day, per_month: policy.per_month },
    ...(features === undefined ? {} : { features }),
  });
}

function reachedBy(keeping: Keeping): (key: string) => Effect.Effect<Registration, AccountFailure> {
  return (key) =>
    Effect.suspend(() => {
      const { up, closed } = keeping.settings();
      if (!up) return Effect.fail(unreachable('The account service could not be reached'));
      const registration = keeping.registered(key);
      if (registration === undefined) return Effect.fail(keeping.refusalOf(key));
      return closed === undefined ? Effect.succeed(registration) : Effect.fail(new AccountFailure(closed));
    });
}

function portsOf(keeping: Keeping, allocations: AllocationFake['ports']): AccountPorts {
  const reached = reachedBy(keeping);
  const licensedFor = (registration: Registration, { licensed }: Usage, reporting: boolean): Signed => {
    keeping.charge(registration, licensed, reporting);
    return licenseOf(keeping, registration, licensed);
  };
  return {
    ...allocations,
    activate: (key, usage) =>
      Effect.map(reached(key), (registration) => {
        keeping.activated(usage);
        return licensedFor(registration, usage, false);
      }),
    report: (key, usage) =>
      Effect.suspend(() => {
        keeping.reportSent();
        return Effect.map(reached(key), (registration) => {
          keeping.reported(usage);
          return licensedFor(registration, usage, true);
        });
      }),
  };
}

type Controls = Omit<AccountFake, 'ports' | keyof Omit<AllocationFake, 'ports'>>;

function controlsOf(keeping: Keeping): Controls {
  return {
    keyFor: (installation, org = 'acme') => {
      const key = `alk.${org}.${installation}.${randomUUID().replaceAll('-', '')}`;
      keeping.register(key, { installation, org });
      return key;
    },
    orgNamed: keeping.name,
    grant: keeping.grant,
    fund: keeping.fund,
    booksOf: keeping.booksOf,
    policy: (policy) => {
      keeping.changed({ policy: { ...keeping.settings().policy, ...policy } });
    },
    revoke: (key, because) => {
      keeping.revoke(key, because);
    },
    close: (closed) => {
      keeping.changed({ closed: { status: 410, kind: 'account_closed', ...closed } });
    },
    goDown: () => {
      keeping.changed({ up: false });
    },
    comeBack: () => {
      keeping.changed({ up: true });
    },
    answer: (how) => {
      keeping.changed({ answering: how });
    },
    at: (moment) => {
      keeping.changed({ now: Date.parse(moment) });
    },
    chargedThrough: keeping.chargedThrough,
    activations: keeping.activations,
    reports: keeping.reports,
    reportsSent: keeping.reportsSent,
    wentBackwards: keeping.wentBackwards,
  };
}

export function accountFake(): AccountFake {
  const keeping = accountKeeping();
  const { ports, ...allocations } = allocationFake({
    reached: reachedBy(keeping),
    iso: (laterMs) => isoOf(keeping, laterMs),
    signed: (payload) => answers[keeping.settings().answering](payload),
  });
  return { ports: portsOf(keeping, ports), ...allocations, ...controlsOf(keeping) };
}
