import { streamPrefixOfPlaybook } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { askedBuild, buildAsked, savedFunction } from '../build-testing/built-versions.ts';
import { modelsStreamOf } from '../facts/model-facts.ts';
import { claimHasEnded, claimsDecider } from './build-claims.ts';

const minute = 60_000;

async function claimsOf(playbook: BuildPlaybook): Promise<readonly (readonly [string, unknown])[]> {
  const types = ['build_asked', 'build_ended'];
  const page = await Effect.runPromise(
    playbook.test.ports.ledger.readRecorded(
      { org: 'acme', playbook: 'alpha' },
      { kind: 'everything' },
      { order: 'asc', limit: 100, types, dataOf: types },
    ),
  );
  return page.records.map(({ type, data }) => [type, Reflect.get(new Object(data), 'build')]);
}

describe('the claim of a build on the models stream of its function', () => {
  it('takes one of two builds asked at once, and refuses the other', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);

    const both = await Promise.all([buildAsked(playbook), buildAsked(playbook)]);

    expect(both.map(({ status }) => status).toSorted()).toEqual(['rejected', 'succeeded']);
    expect(both.find(({ status }) => status === 'rejected')).toMatchObject({ reason: 'conflict' });
    expect(await claimsOf(playbook)).toHaveLength(1);
  });

  it('ends the claim of a build whose run has ended as the next is asked, without waiting for the due work', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const first = await askedBuild(playbook);
    await playbook.cancelled(first);

    const second = await askedBuild(playbook);

    expect(await claimsOf(playbook)).toEqual([
      ['build_asked', first],
      ['build_ended', first],
      ['build_asked', second],
    ]);
  });
});

describe('a claim of a build without a run, as a start that never recorded one leaves', () => {
  it('is ended as the next build is asked, and a claim asked again is taken once', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const stream = `${streamPrefixOfPlaybook({ org: 'acme', playbook: 'alpha' })}${modelsStreamOf('daily-visits')}`;
    const claimed = (build: string) =>
      Effect.runPromise(
        playbook.test.ports.ledger.execute(
          stream,
          claimsDecider,
          {
            at: '2026-10-13T08:00:00.000Z',
            by: 'acme-admin',
            name: 'daily-visits',
            definitionVersion: 1,
            build,
            now: Date.now(),
            perDay: 4,
            ending: [],
          },
          { causationId: null, correlationId: build },
        ),
      );
    await claimed('0199a3c4-7d2e-7c1a-9b3f-000000000001');
    await claimed('0199a3c4-7d2e-7c1a-9b3f-000000000001');

    const build = await askedBuild(playbook);

    expect(await claimsOf(playbook)).toEqual([
      ['build_asked', '0199a3c4-7d2e-7c1a-9b3f-000000000001'],
      ['build_ended', '0199a3c4-7d2e-7c1a-9b3f-000000000001'],
      ['build_asked', build],
    ]);
  });
});

describe('a claim of a build', () => {
  const asked = { build: 'build-1', askedAt: 1_000_000 };

  it('has ended once its run has, or when it has no run', () => {
    expect([
      claimHasEnded(undefined, asked, asked.askedAt),
      claimHasEnded({ status: 'succeeded', awaitsSettlement: false }, asked, asked.askedAt),
      claimHasEnded({ status: 'started', awaitsSettlement: true }, asked, asked.askedAt + 2 * minute),
    ]).toEqual([true, true, false]);
  });

  it('has ended when its run never came to wait for its trainer within the minute a build takes to start', () => {
    expect([
      claimHasEnded({ status: 'started', awaitsSettlement: false }, asked, asked.askedAt + minute / 2),
      claimHasEnded({ status: 'started', awaitsSettlement: false }, asked, asked.askedAt + 2 * minute),
    ]).toEqual([false, true]);
  });
});
