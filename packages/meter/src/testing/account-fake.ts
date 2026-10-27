import { randomUUID } from 'node:crypto';

import { Effect } from 'effect';

import { AccountFailure, unreachable } from '../accounts/account-failure.ts';
import type { AccountPorts, InstallationUsage, Usage } from '../accounts/account-service.ts';
import type { Signed } from '../licensing/signed-answers.ts';
import { allocationFake, type AllocationFake } from './allocation-fake.ts';
import { signedByAnotherKey, signedByTheTestKey } from './test-signing.ts';

export type Answering =
  | 'signed'
  | 'by another key'
  | 'by an unknown key'
  | 'for another installation'
  | 'for another action'
  | 'tampered'
  | 'expired';

interface Registration {
  readonly installation: string;
  readonly org: string;
}

export interface AccountFake extends Omit<AllocationFake, 'ports'> {
  readonly ports: AccountPorts;
  readonly keyFor: (installation: string, org?: string) => string;
  readonly revoke: (key: string) => void;
  readonly exhaust: () => void;
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
  credit: boolean;
  answering: Answering;
}

interface Standing {
  readonly reached: (key: string) => Effect.Effect<Registration, AccountFailure>;
  readonly signed: (payload: Payload) => Signed;
  readonly iso: (laterMs?: number) => string;
  readonly hasCredit: () => boolean;
  readonly repairOf: (installation: string) => Signed | null;
  readonly registered: (key: string, registration: Registration) => void;
  readonly revoked: (key: string) => void;
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

const noCredit = new AccountFailure({
  status: 409,
  kind: 'credits_exhausted',
  detail: 'The org acme has no credits left',
});

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
};

function portsOf(standing: Standing, records: Records, allocations: AllocationFake): AccountPorts {
  return {
    ...allocations.ports,
    activate: (key, usage) =>
      Effect.map(standing.reached(key), ({ installation, org }) => {
        records.activated(usage);
        const entitlement = { v: 1, kind: 'entitlement', installation, org, plan: 'free', issued_at: standing.iso() };
        return {
          entitlement: standing.signed({ ...entitlement, expires_at: standing.iso(sevenDaysMs) }),
          repair: standing.repairOf(installation),
        };
      }),
    admit: (key, run) =>
      Effect.flatMap(standing.reached(key), ({ installation }) => {
        records.asked();
        if (!standing.hasCredit()) return Effect.fail(noCredit);
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
  };
}

function accountStanding(): Standing {
  const registrations = new Map<string, Registration>();
  const repairs = new Map<string, Signed>();
  const state: FakeState = { now: Date.parse('2026-10-27T12:00:00.000Z'), up: true, credit: true, answering: 'signed' };
  return {
    reached: (key) =>
      Effect.suspend(() => {
        const registration = registrations.get(key);
        if (!state.up) return Effect.fail(unreachable('The account service could not be reached'));
        return registration === undefined ? Effect.fail(unknownKey) : Effect.succeed(registration);
      }),
    signed: (payload) => answers[state.answering](payload),
    iso: (laterMs = 0) => new Date(state.now + laterMs).toISOString(),
    hasCredit: () => state.credit,
    repairOf: (installation) => repairs.get(installation) ?? null,
    registered: (key, registration) => {
      registrations.set(key, registration);
    },
    revoked: (key) => {
      registrations.delete(key);
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
    revoke: standing.revoked,
    exhaust: () => {
      standing.changed({ credit: false });
    },
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
