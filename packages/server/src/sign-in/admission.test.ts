import { roleAssignmentDecider } from '@on.auto/access-control';
import { roleAssignmentsStreamOf } from '@on.auto/access-control/role-assignment-facts';
import { makeAppRuntime } from '@on.auto/api';
import type { PeopleRows, PersonSignedIn } from '@on.auto/openid-connect';
import { Conflict, Ledger } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { admittedAfter, enrollingIn, firstSignInNoticed, type Enrolling } from './admission.ts';

async function enrollingOver(layer: Layer.Layer<Ledger>): Promise<Enrolling> {
  const runtime = await makeAppRuntime(layer);
  onTestFinished(() => runtime.dispose());
  return enrollingIn(runtime);
}

const rolesOfTheOrg = `org/default/${roleAssignmentsStreamOf({ type: 'org', id: 'default' })}`;

const noneRecorded: readonly (readonly string[])[] = [];

const ada = '83f8bacd8d76fa75e99f5c9f61599419c6647d9aebe50b453a89da169899d6e1';

const priya = '0c3de111680d66bea9b377080ec7d6784c7602c7bc2e4bfdd1b3ee489b0675ea';

describe("the decision at sign-in, on the server's ledger", () => {
  it('makes the first person the admin of the organization default and the next a viewer, each by themselves, and says when it awaits its first admin', async () => {
    const ledger = memoryLedger();
    const enrolling = await enrollingOver(ledger.layer);

    const before = await enrolling.firstAdminAwaited();
    const answered = [await enrolling.enrolled(ada), await enrolling.enrolled(priya), await enrolling.enrolled(ada)];
    const recorded = await Effect.runPromise(
      ledger.service.load(rolesOfTheOrg, {
        initialState: noneRecorded,
        evolve: (facts: readonly (readonly string[])[], { data, context }) => [
          ...facts,
          [data.principal.id, data.role.id, data.source, context.by],
        ],
        eventSchema: roleAssignmentDecider.eventSchema,
      }),
    );

    expect([before, ...answered, await enrolling.firstAdminAwaited()]).toEqual([
      true,
      { enrolled: 'bootstrap' },
      { enrolled: 'enrolment' },
      { enrolled: 'member' },
      false,
    ]);
    expect(recorded.state).toEqual([
      [ada, 'admin', 'bootstrap', `person:${ada}`],
      [priya, 'viewer', 'enrolment', `person:${priya}`],
    ]);
  });

  it('answers a decision the ledger could not record as a failure, with what the ledger said', async () => {
    const { service } = memoryLedger();
    const contended = Ledger.of({
      ...service,
      execute: () => Effect.fail(new Conflict({ detail: 'contended', kind: 'concurrent_change' })),
    });

    expect(await (await enrollingOver(Layer.succeed(Ledger, contended))).enrolled(ada)).toEqual({
      failed: 'contended',
    });
  });
});

function peopleKept(): { readonly rows: PeopleRows; readonly kept: readonly PersonSignedIn[] } {
  const kept: PersonSignedIn[] = [];
  return {
    kept,
    rows: {
      kept: (signedIn) => {
        kept.push(signedIn);
        return Promise.resolve();
      },
      listed: () => Promise.resolve([]),
      deleted: () => Promise.resolve(),
    },
  };
}

function enrollingAs(enrolment: Awaited<ReturnType<Enrolling['enrolled']>>, awaited = true): Enrolling {
  return { enrolled: () => Promise.resolve(enrolment), firstAdminAwaited: () => Promise.resolve(awaited) };
}

const signedInWith = {
  signedIn: { issuer: 'https://login.example.com/acme', subject: '248289761001' },
  claims: { name: 'Ada Lovelace', email: 'ada@example.com' },
};

describe('a person admitted at sign-in', () => {
  it('is kept with the name and the address their sign-in gave once their role is decided, and not kept where it could not be', async () => {
    const decided = peopleKept();
    const undecided = peopleKept();

    const admitted = await admittedAfter(
      { enrolling: enrollingAs({ enrolled: 'enrolment' }), people: decided.rows },
      signedInWith,
      1,
    );
    const failed = await admittedAfter(
      { enrolling: enrollingAs({ failed: 'contended' }), people: undecided.rows },
      signedInWith,
      1,
    );

    expect([admitted, failed]).toEqual([
      { signedIn: signedInWith.signedIn, person: ada, enrolled: 'enrolment' },
      { failed: 'contended' },
    ]);
    expect([decided.kept, undecided.kept]).toEqual([
      [{ person: ada, name: 'Ada Lovelace', emailAddress: 'ada@example.com', updatedAt: 1 }],
      [],
    ]);
  });
});

describe('the notice at start that the first person to sign in becomes the admin', () => {
  it('is logged while nobody holds the role that gives roles, and not once someone does, nor where the ledger cannot say', async () => {
    const awaited = await linesLoggedBy(firstSignInNoticed(enrollingAs({ enrolled: 'member' }, true)));
    const given = await linesLoggedBy(firstSignInNoticed(enrollingAs({ enrolled: 'member' }, false)));
    const unread = await linesLoggedBy(
      firstSignInNoticed({
        ...enrollingAs({ enrolled: 'member' }),
        firstAdminAwaited: () => Promise.reject(new Error('unread')),
      }),
    );

    expect([awaited.length, given, unread]).toEqual([1, [], []]);
    expect(awaited[0]).toContain('"annotations":{"org":"default"}');
  });
});
