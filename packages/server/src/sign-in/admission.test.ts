import { RoleAssignmentChangeSchema, roleAssignmentsStreamOf } from '@on.auto/access-control/role-assignment-facts';
import { makeAppRuntime } from '@on.auto/api';
import { personIdOf, type PeopleRows, type PersonSignedIn, type SignedInWith } from '@on.auto/openid-connect';
import { Conflict, Ledger } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Function, Layer } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { admittedAfter, enrollingIn, firstSignInNoticed, type Admitting, type Enrolling } from './admission.ts';

async function enrollingOver(layer: Layer.Layer<Ledger>): Promise<Enrolling> {
  const runtime = await makeAppRuntime(layer);
  onTestFinished(() => runtime.dispose());
  return enrollingIn(runtime);
}

type Setup = Admitting['setup'];

const setupUnasked: Setup = { requiredClaimSet: () => Promise.reject(new Error('Not asked')) };

const quiet = Function.constVoid;

const unreported: Admitting['report'] = { nameUnread: quiet, notRevoked: quiet, addressNotForgotten: quiet };

const quietly = { invitations: { forgotten: () => Promise.resolve() }, report: unreported };

const rolesOfTheOrg = `org/default/${roleAssignmentsStreamOf({ type: 'org', id: 'default' })}`;

const noneRecorded: readonly (readonly string[])[] = [];

const ada = '83f8bacd8d76fa75e99f5c9f61599419c6647d9aebe50b453a89da169899d6e1';

const priya = '0c3de111680d66bea9b377080ec7d6784c7602c7bc2e4bfdd1b3ee489b0675ea';

describe("the decision at sign-in, on the server's ledger", () => {
  it('makes the first person the admin of the organization default and the next a viewer, each by themselves, and says when it awaits its first admin and who holds a role', async () => {
    const ledger = memoryLedger();
    const enrolling = await enrollingOver(ledger.layer);

    const before = await enrolling.firstAdminAwaited();
    const heldBefore = await enrolling.holdsARole(priya);
    const answered = [await enrolling.enrolled(ada), await enrolling.enrolled(priya), await enrolling.enrolled(ada)];
    const recorded = await Effect.runPromise(
      ledger.service.load(rolesOfTheOrg, {
        initialState: noneRecorded,
        evolve: (facts: readonly (readonly string[])[], { data, context }) => [
          ...facts,
          [data.principal.id, data.role.id, data.source, context.by],
        ],
        eventSchema: RoleAssignmentChangeSchema,
      }),
    );

    expect([before, ...answered, await enrolling.firstAdminAwaited()]).toEqual([
      true,
      { enrolled: 'bootstrap' },
      { enrolled: 'enrolment' },
      { enrolled: 'member' },
      false,
    ]);
    expect([heldBefore, await enrolling.holdsARole(priya)]).toEqual([false, true]);
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
      found: () => Promise.resolve().then(Function.constUndefined),
      deleted: () => Promise.resolve(),
    },
  };
}

function enrollingAs(enrolment: Awaited<ReturnType<Enrolling['enrolled']>>, awaited = true): Enrolling {
  return {
    enrolled: () => Promise.resolve(enrolment),
    holdsARole: () => Promise.resolve(true),
    firstAdminAwaited: () => Promise.resolve(awaited),
    invitationPending: () => Promise.resolve(false),
  };
}

const signedInWith = {
  signedIn: { issuer: 'https://login.example.com/acme', subject: '248289761001' },
  claims: { name: 'Ada Lovelace', email: 'ada@example.com' },
};

describe('a person admitted at sign-in', () => {
  it('is kept with the name and the address their sign-in gave once their role is decided, and not kept where it could not be', async () => {
    const [decided, undecided] = [peopleKept(), peopleKept()];
    const admitting = { setup: setupUnasked, requiredClaim: undefined, ...quietly };

    const admitted = await admittedAfter(
      { ...admitting, enrolling: enrollingAs({ enrolled: 'enrolment' }), people: decided.rows },
      signedInWith,
      1,
    );
    const failed = await admittedAfter(
      { ...admitting, enrolling: enrollingAs({ failed: 'contended' }), people: undecided.rows },
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

function enrollingNoted(): { readonly enrolling: Enrolling; readonly decided: readonly string[] } {
  const decided: string[] = [];
  return {
    decided,
    enrolling: {
      enrolled: (person) => {
        decided.push(person);
        return Promise.resolve({ enrolled: 'enrolment' });
      },
      holdsARole: () => Promise.resolve(true),
      firstAdminAwaited: () => Promise.resolve(false),
      invitationPending: () => Promise.resolve(false),
    },
  };
}

describe('a person admitted at sign-in where the server requires a claim', () => {
  it('is decided and kept only where their ID Token carries the claim with exactly the value given, and is otherwise refused for that claim before any decision, with no set-up read or written', async () => {
    const { enrolling, decided } = enrollingNoted();
    const people = peopleKept();
    const requiredClaim = { claim: 'tenant', requiredValue: 'acme' };
    const admitting = { enrolling, setup: setupUnasked, people: people.rows, requiredClaim, ...quietly };
    const carrying: readonly SignedInWith[] = [
      signedInWith,
      { ...signedInWith, valueOfTheRequiredClaim: 'ACME' },
      { ...signedInWith, valueOfTheRequiredClaim: 'acme ' },
      { ...signedInWith, valueOfTheRequiredClaim: 'another' },
      { ...signedInWith, valueOfTheRequiredClaim: 'acme' },
    ];

    const answered = await Promise.all(carrying.map((signedIn) => admittedAfter(admitting, signedIn, 1)));

    const refused = { refusedForTheClaim: requiredClaim };
    expect(answered).toEqual([
      refused,
      refused,
      refused,
      refused,
      { signedIn: signedInWith.signedIn, person: ada, enrolled: 'enrolment' },
    ]);
    expect([decided, people.kept.length]).toEqual([[ada], 1]);
  });
});

function signedInCarrying(subject: string, value?: string): SignedInWith {
  return {
    signedIn: { ...signedInWith.signedIn, subject },
    claims: {},
    ...(value === undefined ? {} : { valueOfTheRequiredClaim: value }),
  };
}

const idOf = (subject: string) => personIdOf({ ...signedInWith.signedIn, subject });

const valueRecorded = { claim: 'tenant' };

type Asked = Parameters<Setup['requiredClaimSet']>[0];

function trustedOnFirstUse(): { readonly setup: Setup; readonly asked: readonly Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    setup: {
      requiredClaimSet: (claim) => {
        asked.push(claim);
        return Promise.resolve(asked[0] ?? claim);
      },
    },
  };
}

function admittingBy(setup: Setup) {
  const [{ enrolling, decided }, people] = [enrollingNoted(), peopleKept()];
  const admitting = { enrolling, setup, people: people.rows, requiredClaim: valueRecorded, ...quietly };
  return { admitting, decided, people };
}

const refusedForTheValue = { refusedForTheClaim: valueRecorded };

describe('a person admitted at sign-in where the server requires a claim whose value no setting gives', () => {
  it('asks the set-up for the value in force with the one their ID Token carries, by the issuer and their id, and is admitted only where the two are equal, and refused before any decision otherwise or where no value is carried', async () => {
    const { setup, asked } = trustedOnFirstUse();
    const { admitting, decided, people } = admittingBy(setup);

    const answered = [
      await admittedAfter(admitting, signedInCarrying('ada', 'acme'), 1),
      await admittedAfter(admitting, signedInCarrying('priya', 'another'), 1),
      await admittedAfter(admitting, signedInCarrying('priya', 'ACME'), 1),
      await admittedAfter(admitting, signedInCarrying('grace'), 1),
      await admittedAfter(admitting, signedInCarrying('grace', 'acme'), 1),
    ];

    const [first, colleague] = [idOf('ada'), idOf('grace')];
    const refused = refusedForTheValue;
    expect(answered).toMatchObject([{ person: first }, refused, refused, refused, { person: colleague }]);
    expect([asked.length, asked[0]]).toEqual([
      4,
      { issuer: signedInWith.signedIn.issuer, claim: 'tenant', value: 'acme', person: first },
    ]);
    expect([decided, people.kept.map(({ person }) => person)]).toEqual([
      [first, colleague],
      [first, colleague],
    ]);
  });

  it('refuses a person whose value equals one in force at another issuer or for another claim', async () => {
    const atAnotherIssuer: Setup = {
      requiredClaimSet: (claim) => Promise.resolve({ ...claim, issuer: 'https://login.example.com/other' }),
    };
    const forAnotherClaim: Setup = { requiredClaimSet: (claim) => Promise.resolve({ ...claim, claim: 'org' }) };

    expect([
      await admittedAfter(admittingBy(atAnotherIssuer).admitting, signedInCarrying('ada', 'acme'), 1),
      await admittedAfter(admittingBy(forAnotherClaim).admitting, signedInCarrying('ada', 'acme'), 1),
    ]).toEqual([refusedForTheValue, refusedForTheValue]);
  });
});

describe('a sign-in where the set-up could not answer the value in force', () => {
  it('fails as the set-up failed, with nothing decided or kept', async () => {
    const { admitting, decided, people } = admittingBy({
      requiredClaimSet: () => Promise.resolve({ failed: 'contended' }),
    });

    const answered = await admittedAfter(admitting, signedInCarrying('ada', 'acme'), 1);

    expect([answered, decided, people.kept]).toEqual([{ failed: 'contended' }, [], []]);
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
