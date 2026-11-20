import { makeAppRuntime } from '@on.auto/api';
import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { Conflict, Ledger, type StreamReader, type StreamWriter } from '@on.auto/operations';
import { memoryLedger, type MemoryLedger } from '@on.auto/operations/testing';
import { Effect, Layer, Result } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import {
  requiredClaimSetBy,
  setupDecider,
  SetupEventSchema,
  setupIn,
  setupReopened,
  setupStream,
  type RequiredClaimSet,
} from './setup.ts';

const ada = '83f8bacd8d76fa75e99f5c9f61599419c6647d9aebe50b453a89da169899d6e1';

const priya = '0c3de111680d66bea9b377080ec7d6784c7602c7bc2e4bfdd1b3ee489b0675ea';

const issuer = 'https://login.example.com/acme';

const acme: RequiredClaimSet = { issuer, claim: 'tenant', value: 'acme', person: ada };

const another: RequiredClaimSet = { issuer, claim: 'tenant', value: 'another', person: priya };

const acted = { at: '2026-11-18T09:00:00.000Z', by: 'runtime' };

const collecting = {
  ...setupDecider,
  initialState: [],
  evolve: (facts: readonly unknown[], fact: unknown) => [...facts, fact],
};

async function factsIn(ledger: MemoryLedger): Promise<readonly unknown[]> {
  return (await Effect.runPromise(ledger.service.load(setupStream, collecting))).state;
}

function setBy(registry: StreamReader & StreamWriter, asked: RequiredClaimSet): Promise<RequiredClaimSet> {
  return Effect.runPromise(requiredClaimSetBy({ registry }, asked));
}

function loggedSetting(registry: StreamReader & StreamWriter, asked: RequiredClaimSet): Promise<readonly string[]> {
  return linesLoggedBy(Effect.orDie(Effect.asVoid(requiredClaimSetBy({ registry }, asked))));
}

describe('the decider of the set-up of this server', () => {
  it('records the claim a first sign-in carries where none is in force and nothing where one is, and ends the one in force when set-up is opened again, and nothing where none is', () => {
    const none = setupDecider.initialState;
    const inForce = setupDecider.evolve(none, { type: 'required_claim_set', data: acme, context: acted });
    const reopened = setupDecider.evolve(inForce, { type: 'setup_reopened', data: {}, context: acted });

    const decided = [
      Result.getOrThrow(setupDecider.decide({ kind: 'tie', set: acme, ...acted }, none)),
      Result.getOrThrow(setupDecider.decide({ kind: 'tie', set: another, ...acted }, inForce)),
      Result.getOrThrow(setupDecider.decide({ kind: 'reopen', ...acted }, inForce)),
      Result.getOrThrow(setupDecider.decide({ kind: 'reopen', ...acted }, reopened)),
    ];

    expect([none, inForce, reopened]).toEqual([undefined, acme, undefined]);
    expect(decided).toEqual([
      [{ type: 'required_claim_set', data: acme }],
      [],
      [{ type: 'setup_reopened', data: {} }],
      [],
    ]);
    expect(setupDecider.context({ kind: 'reopen', ...acted }, inForce)).toEqual(acted);
  });
});

describe('the claim the first sign-in to this server carries', () => {
  it('is recorded once, as a fact by the person who signed in that names them by their id, logged once without its value, and is read from the ledger as the one in force at every later sign-in', async () => {
    const ledger = memoryLedger();

    const first = await loggedSetting(ledger.service, acme);
    const later = await loggedSetting(ledger.service, another);

    expect([first.length, later, await setBy(ledger.service, another)]).toEqual([1, [], acme]);
    expect(first[0]).not.toContain('"acme"');
    expect(await factsIn(ledger)).toMatchObject([
      { type: 'required_claim_set', data: acme, context: { by: `person:${ada}` } },
    ]);
  });

  it('is the one the next sign-in carries on a database that holds none, as a server whose database was lost', async () => {
    await setBy(memoryLedger().service, acme);

    expect(await setBy(memoryLedger().service, another)).toEqual(another);
  });
});

describe('two first sign-ins at the same moment, on one server or on two servers of one database', () => {
  it('record exactly one claim, and the other sign-in is answered that one, whether they carry two values or the same', async () => {
    const [twoValues, oneValue] = [memoryLedger(), memoryLedger()];
    const atOnce = (ledger: MemoryLedger, second: RequiredClaimSet) =>
      Effect.runPromise(
        Effect.all(
          [
            requiredClaimSetBy({ registry: ledger.service }, acme),
            requiredClaimSetBy({ registry: ledger.service }, second),
          ],
          {
            concurrency: 'unbounded',
          },
        ),
      );

    const [first, second] = await atOnce(twoValues, another);
    const [same, again] = await atOnce(oneValue, { ...acme, person: priya });

    expect([second, again]).toEqual([first, same]);
    expect([await factsIn(twoValues), await factsIn(oneValue)].map((facts) => facts.length)).toEqual([1, 1]);
    expect(await factsIn(twoValues)).toMatchObject([{ data: first }]);
  });

  it('cannot be answered where the ledger refuses the record and no claim is in force, and the set-up says so as a failure', async () => {
    const { service } = memoryLedger();
    const refusing = Ledger.of({
      ...service,
      execute: () => Effect.fail(new Conflict({ detail: 'refused', kind: 'concurrent_change' })),
    });
    const runtime = await makeAppRuntime(Layer.succeed(Ledger, refusing));
    onTestFinished(() => runtime.dispose());

    const failed = await Effect.runPromise(Effect.flip(requiredClaimSetBy({ registry: refusing }, acme)));

    expect(failed).toMatchObject({ _tag: 'conflict' });
    expect(await setupIn(runtime).requiredClaimSet(acme)).toEqual({ failed: 'refused' });
  });
});

function streamsExecutedBy(ledger: MemoryLedger): {
  readonly registry: StreamReader & StreamWriter;
  readonly streams: readonly string[];
} {
  const streams: string[] = [];
  return {
    streams,
    registry: {
      ...ledger.service,
      execute: (stream, decider, command, lineage) => {
        streams.push(stream);
        return ledger.service.execute(stream, decider, command, lineage);
      },
    },
  };
}

interface SignedOut {
  readonly providerRows: { readonly endedEvery: (models: readonly string[]) => Promise<void> };
  readonly times: () => number;
}

function signingOutCounted(): SignedOut {
  const counted = { times: 0 };
  return {
    providerRows: {
      endedEvery: () => {
        counted.times += 1;
        return Promise.resolve();
      },
    },
    times: () => counted.times,
  };
}

describe('set-up of this server opened again by whoever runs it', () => {
  it('ends the claim in force and every session, says so, writes to no other stream, and lets the next sign-in record the claim it carries', async () => {
    const ledger = memoryLedger();
    await setBy(ledger.service, acme);
    const [signingOut, watched] = [signingOutCounted(), streamsExecutedBy(ledger)];

    const reopened = await Effect.runPromise(
      setupReopened({ registry: watched.registry, providerRows: signingOut.providerRows }, 'runtime'),
    );
    const next = await setBy(ledger.service, another);

    expect([reopened, watched.streams, signingOut.times(), next]).toEqual([true, [setupStream], 1, another]);
    expect(await factsIn(ledger)).toMatchObject([
      { type: 'required_claim_set', data: acme },
      { type: 'setup_reopened', data: {}, context: { by: 'runtime' } },
      { type: 'required_claim_set', data: another },
    ]);
  });

  it('signs everyone out again where an earlier run opened it and could not confirm its sign-out, and records nothing more', async () => {
    const ledger = memoryLedger();
    await setBy(ledger.service, acme);
    const failing = { endedEvery: () => Promise.reject(new Error('the sign-in store of the test is busy')) };
    const signingOut = signingOutCounted();

    const unconfirmed = await Effect.runPromise(
      Effect.flip(setupReopened({ registry: ledger.service, providerRows: failing }, 'runtime')),
    );
    const again = await Effect.runPromise(
      setupReopened({ registry: ledger.service, providerRows: signingOut.providerRows }, 'runtime'),
    );

    expect(unconfirmed).toMatchObject({ _tag: 'SignOutUnconfirmed', message: 'the sign-in store of the test is busy' });
    expect([again, signingOut.times()]).toEqual([true, 1]);
    expect(await factsIn(ledger)).toMatchObject([{ type: 'required_claim_set' }, { type: 'setup_reopened' }]);
  });

  it('records nothing where no claim was ever recorded, and then ends no session and logs nothing', async () => {
    const ledger = memoryLedger();
    const signingOut = signingOutCounted();

    const lines = await linesLoggedBy(
      Effect.orDie(
        Effect.asVoid(setupReopened({ registry: ledger.service, providerRows: signingOut.providerRows }, 'runtime')),
      ),
    );

    expect([lines.length, signingOut.times(), await factsIn(ledger)]).toEqual([0, 0, []]);
  });
});

describe('the facts of the set-up of this server', () => {
  recordedFactsBehaviour({
    schema: SetupEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.66.0': [
        {
          type: 'required_claim_set',
          data: {
            issuer: 'https://login.example.com/tenant/v2.0',
            claim: 'tenant',
            value: 'a-value-of-the-test',
            person: '83f8bacd8d76fa75e99f5c9f61599419c6647d9aebe50b453a89da169899d6e1',
          },
          context: {
            at: '2026-11-18T09:00:00.000Z',
            by: 'person:83f8bacd8d76fa75e99f5c9f61599419c6647d9aebe50b453a89da169899d6e1',
          },
        },
        { type: 'setup_reopened', data: {}, context: { at: '2026-11-18T10:00:00.000Z', by: 'runtime' } },
      ],
    },
  });
});
