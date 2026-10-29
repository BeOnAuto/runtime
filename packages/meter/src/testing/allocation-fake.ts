import { randomUUID } from 'node:crypto';

import { Effect, Option } from 'effect';

import { AccountFailure } from '../accounts/account-failure.ts';
import type { AccountPorts, SignedReport } from '../accounts/account-service.ts';
import { reportSignatureOf } from '../allocations/report-signature.ts';
import type { Signed } from '../licensing/signed-answers.ts';

type Payload = Readonly<Record<string, unknown>>;

interface Reaching {
  readonly reached: (key: string) => Effect.Effect<{ readonly installation: string }, AccountFailure>;
  readonly iso: (laterMs?: number) => string;
  readonly signed: (payload: Payload) => Signed;
}

interface Held {
  readonly id: string;
  readonly installation: string;
  readonly credits: number;
  readonly issued_at: string;
  readonly refresh_by: string;
  readonly days: number;
  readonly status: 'open' | 'closed';
  readonly sequence: number;
  readonly spent: number;
}

interface Books {
  readonly heldAs: (id: string) => Held | undefined;
  readonly kept: (allocation: Held) => void;
  readonly taken: (report: TakenReport) => void;
}

interface TakenReport extends SignedReport {
  readonly taken: string;
}

export interface AllocationFake {
  readonly ports: Pick<AccountPorts, 'refreshAllocation' | 'reportAllocation'>;
  readonly allocationFor: (installation: string, credits: number, days?: 30 | 90) => Signed;
  readonly closeAllocation: (id: string) => void;
  readonly allocationReports: () => readonly TakenReport[];
}

const dayMs = 86_400_000;

function payloadOf({ installation, id, credits, issued_at: issuedAt, refresh_by: refreshBy }: Held): Payload {
  return { v: 1, kind: 'allocation', installation, id, credits, issued_at: issuedAt, refresh_by: refreshBy };
}

function judged(held: Held, { report }: SignedReport): string {
  const frozen =
    report.installation !== held.installation ||
    report.sequence <= held.sequence ||
    report.spent < held.spent ||
    report.spent > held.credits;
  return frozen ? 'frozen' : 'taken';
}

function refreshing(reaching: Reaching, books: Books): AccountPorts['refreshAllocation'] {
  return (key, id) =>
    Effect.flatMap(reaching.reached(key), ({ installation }) => {
      const allocation = books.heldAs(id);
      if (allocation?.installation !== installation) {
        return Effect.fail(
          new AccountFailure({ status: 403, kind: 'license_invalid', detail: 'The key holds no such allocation' }),
        );
      }
      if (allocation.status !== 'open') {
        return Effect.fail(
          new AccountFailure({
            status: 409,
            kind: 'license_invalid',
            detail: `The allocation is ${allocation.status}`,
          }),
        );
      }
      const refreshed = { ...allocation, refresh_by: reaching.iso(allocation.days * dayMs) };
      books.kept(refreshed);
      return Effect.succeed(reaching.signed(payloadOf(refreshed)));
    });
}

function reporting(reaching: Reaching, books: Books): AccountPorts['reportAllocation'] {
  return (key, signed) =>
    Effect.map(reaching.reached(key), () => {
      const allocation = books.heldAs(signed.report.allocation);
      const answer =
        allocation === undefined || reportSignatureOf(key, signed.report) !== signed.signature
          ? 'The report is not signed by its installation'
          : judged(allocation, signed);
      if (allocation !== undefined && answer === 'taken') {
        books.kept({ ...allocation, sequence: signed.report.sequence, spent: signed.report.spent });
      }
      books.taken({ ...signed, taken: answer });
      return answer;
    });
}

export function allocationFake(reaching: Reaching): AllocationFake {
  const held = new Map<string, Held>();
  const taken: TakenReport[] = [];
  const books: Books = {
    heldAs: (id) => held.get(id),
    kept: (allocation) => {
      held.set(allocation.id, allocation);
    },
    taken: (report) => {
      taken.push(report);
    },
  };
  return {
    ports: { refreshAllocation: refreshing(reaching, books), reportAllocation: reporting(reaching, books) },
    allocationFor: (installation, credits, days = 30) => {
      const allocation: Held = {
        id: randomUUID(),
        installation,
        credits,
        issued_at: reaching.iso(),
        refresh_by: reaching.iso(days * dayMs),
        days,
        status: 'open',
        sequence: 0,
        spent: 0,
      };
      books.kept(allocation);
      return reaching.signed(payloadOf(allocation));
    },
    closeAllocation: (id) => {
      for (const allocation of Option.toArray(Option.fromNullishOr(held.get(id)))) {
        books.kept({ ...allocation, status: 'closed' });
      }
    },
    allocationReports: () => [...taken],
  };
}
