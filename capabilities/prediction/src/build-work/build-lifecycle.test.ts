import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import {
  answered,
  asked,
  askedBuild,
  modelFactsOf,
  runOf,
  savedFunction,
  standingOf,
  uploaded,
  workOf,
} from '../build-testing/built-versions.ts';
import { candidateSha256, performedOnce, performedUntilQuiet } from '../build-testing/due-driving.ts';
import { predictionBuildsName } from '../builds/build-rows.ts';
import { buildsDue } from '../builds/builds-due.ts';
import type { PredictionPorts } from '../capability/prediction-ports.ts';
import { activateVersion } from '../models/activate-version.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const anInstant: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u);

const theTrainer = { id: 'acme-admin', name: 'acme-admin' };

describe('a build of a prediction function over an uploaded dataset, answered through the inbox', () => {
  it('waits for its trainer, takes a candidate, scores it, builds and activates its first version, and answers a question', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    const waiting = await standingOf(playbook);
    await uploaded(playbook, build, ['visits-mean']);
    await answered(playbook, build, {
      candidates: [candidateSha256('visits-mean')],
      recipe: 'The mean of the window',
      limitations: 'It sees no trend',
    });
    await performedUntilQuiet(playbook);

    expect(waiting).toMatchObject({
      output: {
        standing: {
          models: { active: null, latest: null, versions: 0, challenger: null },
          build: {
            run_id: build,
            standing: 'waiting_for_trainer',
            requested_at: anInstant,
            candidates: 0,
            scored: 0,
          },
        },
      },
    });
    expect(await standingOf(playbook)).toMatchObject({
      output: { standing: { models: { active: { version: 1 }, latest: 1, versions: 1 }, build: null } },
    });
    expect((await modelFactsOf(playbook))[0]).toMatchObject({
      type: 'version_built',
      data: { recipe_bytes: 22, limitations_bytes: 16, trained_by: theTrainer, rule: 'automatic' },
    });
    expect(await asked(playbook, { series: 'north', horizon: 1 })).toMatchObject({
      output: {
        status: 'succeeded',
        output: { lines: [{ name: 'observed' }, { name: 'predicted', points: [{ value: 11, low: 9, high: 13 }] }] },
        record: { version: 1 },
      },
    });
    expect(await playbook.send(activateVersion, { name: 'daily-visits', version: 1 })).toMatchObject({
      status: 'rejected',
      kind: 'already_active',
    });
  });
});

describe('a build of a prediction function performed by the due work of the host', () => {
  it('rests when it is performed before its trainer answers', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await Effect.runPromise(
      playbook.test.ports.ledger.advanceRow(predictionBuildsName, alpha, build, {
        set: { next_due_at: 0 },
        when: [],
      }),
    );

    expect(await performedOnce(playbook.due, Date.now())).toBe(1);
    expect(await performedOnce(playbook.due, Date.now())).toBe(0);
    expect(await workOf(playbook, build)).toHaveLength(1);
  });

  it('is due again at once for the due work of the host while it scores, and not while it waits', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    const due = buildsDue({ ports: playbook.test.ports, runs: playbook.startChild });
    const waiting = await Effect.runPromise(due.nextDueAt(0));
    await answered(playbook, build, { candidates: [] });

    expect([waiting, await Effect.runPromise(due.nextDueAt(0))]).toEqual([null, expect.any(Number)]);
  });
});

describe('a build whose trainer answers while the due work of the host performs it', () => {
  it('stays due when its trainer answers after a step read it waiting and before the step writes its rest', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    const { ports } = playbook.test;
    await Effect.runPromise(
      ports.ledger.advanceRow(predictionBuildsName, alpha, build, { set: { next_due_at: 0 }, when: [] }),
    );
    const answeredMeanwhile: PredictionPorts = {
      ...ports,
      ledger: {
        ...ports.ledger,
        advanceRow: (projection, playbookAddress, key, advance) =>
          Effect.andThen(
            Effect.promise(() => answered(playbook, build, { candidates: [] })),
            ports.ledger.advanceRow(projection, playbookAddress, key, advance),
          ),
      },
    };
    await performedOnce([buildsDue({ ports: answeredMeanwhile, runs: playbook.startChild })], playbook.now());
    await performedUntilQuiet(playbook);

    expect(await runOf(playbook, build)).toMatchObject({
      output: { status: 'succeeded', output: { version: null, candidates: [] } },
    });
  });
});
