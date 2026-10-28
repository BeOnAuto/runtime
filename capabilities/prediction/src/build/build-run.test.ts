import type { RecordedContent } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook } from '../build-testing/build-playbook.ts';
import { answered, askedBuild, buildAsked, runOf, savedFunction, visitsRows } from '../build-testing/built-versions.ts';
import { performedUntilQuiet } from '../build-testing/due-driving.ts';
import { candidateSha256, uploaded } from '../runtime-testing/scripted-candidates.ts';
import { dailyVisitsWith, uploadedDailyVisits } from '../testing/daily-documents.ts';

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const anInstant: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);

const someBytes: unknown = expect.any(Number);

const askAgainLater: unknown = expect.stringMatching(
  /^This function has had its 1 builds of the day; ask again after \d{4}-/u,
);

interface CountedPuts {
  readonly content: (kept: RecordedContent) => RecordedContent;
  readonly count: () => number;
}

function countedPuts(): CountedPuts {
  const puts = { count: 0 };
  return {
    content: (kept) => ({
      ...kept,
      put: (playbook, content) =>
        Effect.andThen(
          Effect.sync(() => {
            puts.count += 1;
          }),
          kept.put(playbook, content),
        ),
    }),
    count: () => puts.count,
  };
}

const routes = (build: string) => {
  const base = `/v1/orgs/acme/playbooks/alpha/runs/${build}/build`;
  return { brief: `${base}/brief`, rows: `${base}/rows`, candidates: `${base}/candidates` };
};

describe('a build of a prediction function', () => {
  it('assembles its dataset, keeps its brief and waits for its trainer with a request that names its routes and the formats its candidates take', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    const run = await runOf(playbook, build);

    expect(run).toMatchObject({
      status: 'succeeded',
      output: {
        status: 'started',
        record: {
          to: 'trainer',
          answer_schema: { required: ['candidates'] },
          expires_at: anInstant,
          requested_at: anInstant,
          build: {
            brief_sha256: aDigest,
            brief_bytes: 133,
            training_sha256: aDigest,
            training_bytes: someBytes,
            routes: routes(build),
            formats: ['scripted'],
          },
        },
      },
    });
    expect(JSON.stringify(run)).toContain(
      `Build ${build} of the prediction function daily-visits waits for its trainer`,
    );
    expect(JSON.stringify(run)).toContain('Fit a model of the daily visits of each of 2 stores.');
    expect(JSON.stringify(run)).toContain(
      `Upload each candidate model with POST ${routes(build).candidates}, which takes a file in the format scripted, then answer`,
    );
  });

  it('is refused while another build of the function is in flight, naming it', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const first = await askedBuild(playbook);

    expect(await buildAsked(playbook)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'build_in_flight',
      detail: `A build of this function is in flight, run ${first}; wait for it or cancel it`,
    });
  });
});

describe('a build of a prediction function that is refused by its claim', () => {
  it('writes no rows and no brief while another build is in flight or the builds of the day are spent', async () => {
    const puts = countedPuts();
    const playbook = buildPlaybook({ bounds: { buildsPerDay: 2 }, content: puts.content });
    await savedFunction(playbook);
    const first = await askedBuild(playbook);
    const keptByTheFirst = puts.count();
    const inFlight = await buildAsked(playbook);
    const keptWhileInFlight = puts.count() - keptByTheFirst;
    await playbook.cancelled(first);
    await playbook.cancelled(await askedBuild(playbook));
    const keptByTheSecond = puts.count();
    const ofTheDay = await buildAsked(playbook);

    expect([inFlight, ofTheDay]).toMatchObject([
      { status: 'rejected', kind: 'build_in_flight' },
      { status: 'rejected', kind: 'builds_full', because: 'builds_of_the_day' },
    ]);
    expect([keptByTheFirst > 0, keptWhileInFlight, puts.count() - keptByTheSecond]).toEqual([true, 0, 0]);
  });
});

describe('the builds a server takes', () => {
  it('are bounded for each function in a day, and say when the next one may be asked', async () => {
    const playbook = buildPlaybook({ bounds: { buildsPerDay: 1 } });
    await savedFunction(playbook);
    const first = await askedBuild(playbook);
    await playbook.cancelled(first);

    expect(await buildAsked(playbook)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'builds_full',
      detail: askAgainLater,
    });
  });

  it('are bounded across the functions of the deployment by the builds being scored, not those that wait for a trainer', async () => {
    const playbook = buildPlaybook({ bounds: { buildsAtOnce: 1 } });
    await savedFunction(playbook);
    await savedFunction(playbook, { name: 'other-visits' });
    await savedFunction(playbook, { name: 'third-visits' });
    const scored = await askedBuild(playbook);
    const waiting = await buildAsked(playbook, 'other-visits');
    await uploaded(playbook, scored, ['visits-mean']);
    await answered(playbook, scored, { candidates: [candidateSha256('visits-mean')] });
    const whileScored = await buildAsked(playbook, 'third-visits');
    await performedUntilQuiet(playbook);

    expect([waiting, whileScored, await buildAsked(playbook, 'third-visits')]).toMatchObject([
      { status: 'succeeded' },
      {
        status: 'rejected',
        kind: 'builds_full',
        detail: 'Every build this server may score at once is being scored; ask again once one has scored',
      },
      { status: 'succeeded' },
    ]);
  });
});

describe('the builds asked through the inbox', () => {
  it('ask no trainer through the inbox while the playbook holds the most open requests it may', async () => {
    const playbook = buildPlaybook({ openRequests: 64 });
    await savedFunction(playbook);

    expect(await buildAsked(playbook)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'requests_full',
      detail:
        'The playbook holds 64 open requests, the most it may; one must be answered, expire or be cancelled before a build asks its trainer',
    });
  });
});

describe('a build whose dataset or brief does not serve', () => {
  it('is refused while its dataset is not yet made', async () => {
    const playbook = buildPlaybook();
    expect(
      await playbook.call(playbook.operations.create, {
        type: 'prediction',
        name: 'daily-visits',
        source: dailyVisitsWith(),
      }),
    ).toMatchObject({ status: 'succeeded' });

    expect(await buildAsked(playbook)).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'dataset_not_ready',
    });
  });

  it('is refused when its brief renders past 64 KiB over its dataset', async () => {
    const playbook = buildPlaybook();
    const long = '{% if dataset.series < 3 %}{% for each in (1..7000) %}0123456789{% endfor %}{% endif %}';
    const source = `${uploadedDailyVisits(visitsRows.sha256)}\n${long}`;
    await savedFunction(playbook, { source });

    expect(await buildAsked(playbook)).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'unworkable',
      detail:
        'The brief does not render over this dataset within the 65,536 bytes a brief may; shorten it or loop over less',
    });
  });
});
