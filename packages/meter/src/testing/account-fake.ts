import { randomUUID } from 'node:crypto';

import { Effect } from 'effect';

import { AccountFailure, unreachable, type AccountRefusal } from '../accounts/account-failure.ts';
import type { AccountPorts, InstallationUsage, Usage } from '../accounts/account-service.ts';
import type { Signed } from '../licensing/signed-answers.ts';
import { accountRefusals, type AccountRefusals } from './account-refusals.ts';
import { allocationFake, type AllocationFake } from './allocation-fake.ts';
import { signedByAnotherKey, signedByTheTestKey } from './test-signing.ts';

export type Answering =
  | 'signed'
  | 'by another key'
  | 'by an unknown key'
  | 'for another installation'
  | 'for another action'
  | 'tampered'
  | 'expired'
  | 'with more than it knows';

interface Registration {
  readonly installation: string;
  readonly org: string;
}

export type Revocation = 'key_rotated' | 'installation_revoked';

export interface AccountFake extends Omit<AllocationFake, 'ports'>, AccountRefusals {
  readonly ports: AccountPorts;
  readonly keyFor: (installation: string, org?: string) => string;
  readonly orgNamed: (org: string, name: string) => void;
  readonly revoke: (key: string, because?: Revocation) => void;
  readonly goDown: () => void;
  readonly comeBack: () => void;
  readonly answer: (how: Answering) => void;
  readonly repairFor: (installation: string, how?: Answering) => void;
  readonly at: (moment: string) => void;
  readonly charged: () => readonly string[];
  readonly askedToAdmit: () => number;
  readonly activations: () => readonly InstallationUsage[];
  readonly reports: () => readonly Usage[];
  readonly reportsSent: () => number;
}

type Payload = Readonly<Record<string, unknown>>;

interface FakeState {
  now: number;
  up: boolean;
  refusing: AccountRefusal | undefined;
  terms: AccountRefusal | undefined;
  answering: Answering;
}

interface Standing {
  readonly reached: (key: string) => Effect.Effect<Registration, AccountFailure>;
  readonly nameOf: (org: string) => Payload;
  readonly signed: (payload: Payload) => Signed;
  readonly iso: (laterMs?: number) => string;
  readonly refusal: () => AccountFailure | undefined;
  readonly activationRefusal: () => AccountFailure | undefined;
  readonly termsUnaccepted: () => AccountFailure | undefined;
  readonly repairOf: (installation: string) => Signed | null;
  readonly registered: (key: string, registration: Registration) => void;
  readonly named: (org: string, name: string) => void;
  readonly revoked: (key: string, because: Revocation | undefined) => void;
  readonly changed: (change: Readonly<Partial<FakeState>>) => void;
  readonly repairedWith: (installation: string, repair: Signed) => void;
}

interface Records {
  readonly activated: (usage: InstallationUsage) => void;
  readonly asked: () => void;
  readonly charged: (action: string) => void;
  readonly reported: (usage: Usage) => void;
  readonly read: Pick<AccountFake, 'charged' | 'askedToAdmit' | 'activations' | 'reports' | 'reportsSent'>;
}

const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

const unknownKey = new AccountFailure({
  status: 403,
  kind: 'license_invalid',
  detail: 'The key is unknown, was rotated away or its installation was revoked',
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
    detail: 'The installation was removed from its org',
    because: 'installation_revoked',
  }),
};

function tampered(signed: Signed): Signed {
  const text = `${Buffer.from(signed.payload, 'base64url').toString('utf8')} `;
  return { ...signed, payload: Buffer.from(text, 'utf8').toString('base64url') };
}

const answers: Readonly<Record<Answering, (payload: Payload) => Signed>> = {
  signed: (payload) => signedByTheTestKey(payload),
  'by another key': (payload) => signedByAnotherKey()(payload),
  'by an unknown key': (payload) => signedByAnotherKey('rogue-2026-10')(payload),
  'for another installation': (payload) => signedByTheTestKey({ ...payload, installation: 'another-installation' }),
  'for another action': (payload) => signedByTheTestKey({ ...payload, action: 'installation:another/acme/alpha/run' }),
  tampered: (payload) => tampered(signedByTheTestKey(payload)),
  expired: (payload) => signedByTheTestKey({ ...payload, expires_at: payload['issued_at'] }),
  'with more than it knows': (payload) => signedByTheTestKey({ ...payload, seats: 5, region: 'eu' }),
};

function portsOf(standing: Standing, records: Records, allocations: AllocationFake): AccountPorts {
  return {
    ...allocations.ports,
    activate: (key, usage) =>
      Effect.flatMap(standing.reached(key), ({ installation, org }) => {
        const activationRefusal = standing.activationRefusal();
        if (activationRefusal !== undefined) return Effect.fail(activationRefusal);
        records.activated(usage);
        const entitlement = {
          v: 1,
          kind: 'entitlement',
          installation,
          org,
          ...standing.nameOf(org),
          plan: 'free',
          issued_at: standing.iso(),
        };
        return Effect.succeed({
          entitlement: standing.signed({ ...entitlement, expires_at: standing.iso(sevenDaysMs) }),
          repair: standing.repairOf(installation),
        });
      }),
    admit: (key, run) =>
      Effect.flatMap(standing.reached(key), ({ installation }) => {
        records.asked();
        const refusal = standing.refusal();
        if (refusal !== undefined) return Effect.fail(refusal);
        const action = `installation:${installation}/${run.org}/${run.playbook}/${run.run_id.toLowerCase()}`;
        records.charged(action);
        return Effect.succeed(
          standing.signed({ v: 1, kind: 'admission', installation, action, admitted_at: standing.iso() }),
        );
      }),
    report: (key, usage) =>
      Effect.map(standing.reached(key), () => {
        records.reported(usage);
      }),
    refreshAllocation: (key, allocation) =>
      Effect.flatMap(standing.reached(key), () => {
        const unaccepted = standing.termsUnaccepted();
        return unaccepted === undefined
          ? allocations.ports.refreshAllocation(key, allocation)
          : Effect.fail(unaccepted);
      }),
  };
}

function accountStanding(): Standing {
  const registrations = new Map<string, Registration>();
  const revoked = new Map<string, AccountFailure>();
  const repairs = new Map<string, Signed>();
  const names = new Map<string, string>();
  const now = Date.parse('2026-10-27T12:00:00.000Z');
  const state: FakeState = { now, up: true, refusing: undefined, terms: undefined, answering: 'signed' };
  const termsUnaccepted = () => (state.terms === undefined ? undefined : new AccountFailure(state.terms));
  return {
    reached: (key) =>
      Effect.suspend(() => {
        const registration = registrations.get(key);
        if (!state.up) return Effect.fail(unreachable('The account service could not be reached'));
        return registration === undefined ? Effect.fail(revoked.get(key) ?? unknownKey) : Effect.succeed(registration);
      }),
    nameOf: (org) => {
      const name = names.get(org);
      return name === undefined ? {} : { org_name: name };
    },
    signed: (payload) => answers[state.answering](payload),
    iso: (laterMs = 0) => new Date(state.now + laterMs).toISOString(),
    refusal: () => (state.refusing === undefined ? undefined : new AccountFailure(state.refusing)),
    activationRefusal: () =>
      state.refusing?.kind === 'account_closed' ? new AccountFailure(state.refusing) : termsUnaccepted(),
    termsUnaccepted,
    repairOf: (installation) => repairs.get(installation) ?? null,
    registered: (key, registration) => {
      registrations.set(key, registration);
    },
    named: (org, name) => {
      names.set(org, name);
    },
    revoked: (key, because) => {
      registrations.delete(key);
      if (because !== undefined) revoked.set(key, revocations[because]);
    },
    changed: (change) => {
      Object.assign(state, change);
    },
    repairedWith: (installation, repair) => {
      repairs.set(installation, repair);
    },
  };
}

function accountRecords(): Records {
  const charged = new Set<string>();
  const asked = { admissions: 0, reports: 0 };
  const activations: InstallationUsage[] = [];
  const reports = new Map<string | null, Usage>();
  return {
    activated: (usage) => {
      activations.push(usage);
    },
    asked: () => {
      asked.admissions += 1;
    },
    charged: (action) => {
      charged.add(action);
    },
    reported: (usage) => {
      asked.reports += 1;
      reports.set(usage.last, reports.get(usage.last) ?? usage);
    },
    read: {
      charged: () => [...charged],
      askedToAdmit: () => asked.admissions,
      activations: () => [...activations],
      reports: () => [...reports.values()],
      reportsSent: () => asked.reports,
    },
  };
}

export function accountFake(): AccountFake {
  const standing = accountStanding();
  const records = accountRecords();
  const { ports, ...allocations } = allocationFake(standing);
  return {
    ports: portsOf(standing, records, { ports, ...allocations }),
    ...allocations,
    keyFor: (installation, org = 'acme') => {
      const key = `alk.${org}.${installation}.${randomUUID().replaceAll('-', '')}`;
      standing.registered(key, { installation, org });
      return key;
    },
    orgNamed: (org, name) => {
      standing.named(org, name);
    },
    revoke: (key, because) => {
      standing.revoked(key, because);
    },
    ...accountRefusals(standing),
    goDown: () => {
      standing.changed({ up: false });
    },
    comeBack: () => {
      standing.changed({ up: true });
    },
    answer: (how) => {
      standing.changed({ answering: how });
    },
    repairFor: (installation, how = 'signed') => {
      const repair = { v: 1, kind: 'repair', installation, id: randomUUID(), reason: 'Restored from a backup' };
      standing.repairedWith(installation, answers[how]({ ...repair, issued_at: standing.iso() }));
    },
    at: (moment) => {
      standing.changed({ now: Date.parse(moment) });
    },
    ...records.read,
  };
}
