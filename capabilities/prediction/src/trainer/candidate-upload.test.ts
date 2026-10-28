import type { RecordedContent } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { askedBuild, savedFunction, workOf } from '../build-testing/built-versions.ts';
import { weeklyOrderRows } from '../build-testing/uploaded-rows.ts';
import {
  candidateBytes,
  candidateSha256,
  uploaded,
  type CandidateName,
} from '../runtime-testing/scripted-candidates.ts';
import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { uploadedWeeklyOrders } from '../testing/weekly-orders.ts';
import { uploadCandidate } from './candidate-upload.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const notLoaded: unknown = expect.stringMatching(/^The file is not a model the runtime loads: /u);

const namesOtherInputs = 'wrong_signature: The recipe takes the inputs extra, which the playbook does not feed';

function sent(playbook: BuildPlaybook, build: string, name: CandidateName, format?: string) {
  const input = format === undefined ? { run_id: build } : { run_id: build, format };
  return playbook.send(uploadCandidate(playbook.test.ports), input, candidateBytes(name));
}

async function waitingBuild(playbook: BuildPlaybook): Promise<string> {
  await savedFunction(playbook);
  return askedBuild(playbook);
}

describe('a candidate a trainer uploads to a build', () => {
  it('is checked by the runtime of its format and answered with its digest, its bytes, its format and the signature the runtime gives, the same bytes again alike and recorded once', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);
    const signature = { recipe: 'mean', steps: 2, low: 2, high: 2, features: 0, given: 0, totals: false };
    const kept = { sha256: candidateSha256('visits-mean'), bytes: candidateBytes('visits-mean').length };
    const answer = {
      status: 'succeeded',
      output: { candidate: kept.sha256, bytes: kept.bytes, format: 'scripted', signature },
    };

    expect([
      await sent(playbook, build, 'visits-mean'),
      await sent(playbook, build, 'visits-mean', 'scripted'),
    ]).toEqual([answer, answer]);
    expect(await workOf(playbook, build)).toMatchObject([
      { type: 'dataset_assembled' },
      {
        type: 'candidate_uploaded',
        data: { ...kept, format: 'scripted', runtime: { name: 'scripted-runtime', version: '1.0.0' }, signature },
      },
    ]);
  });
});

function stagingThatFailsOnce(kept: RecordedContent): RecordedContent {
  const stages = { failed: false };
  return {
    ...kept,
    stage: (playbook, run, content) => {
      if (stages.failed) {
        return kept.stage(playbook, run, content);
      }
      stages.failed = true;
      return Effect.die(new Error('The server stopped before the candidate was staged'));
    },
  };
}

describe('a candidate recorded but not staged, as when its server stops between the two', () => {
  it('is staged by the trainer sending the same bytes again', async () => {
    const playbook = buildPlaybook({ content: stagingThatFailsOnce });
    const build = await waitingBuild(playbook);
    const first = await sent(playbook, build, 'visits-mean');
    const unstaged = await Effect.runPromise(
      playbook.test.ports.ledger.content.staged(alpha, build, candidateSha256('visits-mean')),
    );
    const again = await sent(playbook, build, 'visits-mean');
    const staged = await Effect.runPromise(
      playbook.test.ports.ledger.content.staged(alpha, build, candidateSha256('visits-mean')),
    );

    expect([first.status, unstaged, again.status, staged?.bytes]).toEqual([
      'failed',
      undefined,
      'succeeded',
      candidateBytes('visits-mean').length,
    ]);
    expect((await workOf(playbook, build)).map(({ type }) => type)).toEqual([
      'dataset_assembled',
      'candidate_uploaded',
    ]);
  });
});

describe('a candidate a build does not take', () => {
  it('is refused when the runtime of its format does not load it, or when it is not in the signature the function feeds', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);

    expect([
      await sent(playbook, build, 'not-a-model'),
      await sent(playbook, build, 'visits-extra-input'),
    ]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', detail: notLoaded },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '', detail: namesOtherInputs }] },
    ]);
    expect((await workOf(playbook, build)).map(({ data }) => data['because'])).toEqual([
      undefined,
      'failed_to_load',
      'wrong_signature',
    ]);
  });
});

const another = { ...scriptedRuntime, name: 'another-runtime', formats: ['another'] };

const withoutFeatures = {
  ...scriptedRuntime,
  name: 'plain-runtime',
  capabilities: { ...scriptedRuntime.capabilities, features: false },
};

function atFormat(detail: string) {
  return { status: 'rejected', reason: 'invalid_input', detail, issues: [{ pointer: '/format', detail }] };
}

describe('the format of a candidate', () => {
  it('is refused at /format, unread and unrecorded, when no runtime of the server executes it for the function, naming the formats it takes', async () => {
    const playbook = buildPlaybook({ runtimes: [scriptedRuntime, another] });
    const build = await waitingBuild(playbook);

    expect([
      await sent(playbook, build, 'visits-mean', 'graph'),
      await sent(playbook, build, 'visits-mean'),
    ]).toMatchObject([
      atFormat('The format graph is not one this server executes for this function, which takes scripted or another'),
      atFormat('Name the format of the candidate, one of scripted or another'),
    ]);
    expect((await workOf(playbook, build)).map(({ type }) => type)).toEqual(['dataset_assembled']);
  });

  it('is refused when no runtime the server installed executes a candidate the function feeds, its features among them', async () => {
    const none = buildPlaybook({ runtimes: [] });
    const plain = buildPlaybook({ runtimes: [withoutFeatures] });
    const noneBuild = await waitingBuild(none);
    await savedFunction(plain, {
      name: 'weekly-orders',
      rows: weeklyOrderRows,
      source: uploadedWeeklyOrders(weeklyOrderRows.sha256).replace(
        '  holdout: 12',
        '  holdout: 12\n  baselines: [seasonal-naive]',
      ),
    });
    const plainBuild = await askedBuild(plain, 'weekly-orders');
    const refused = 'No model runtime this server has installed executes a candidate for this function';

    expect([
      await sent(none, noneBuild, 'visits-mean'),
      await sent(plain, plainBuild, 'orders-last', 'scripted'),
    ]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', detail: refused },
      { status: 'rejected', reason: 'invalid_input', detail: refused },
    ]);
  });
});

describe('the candidates of a build', () => {
  it('are refused past the eight a build takes', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);
    await uploaded(playbook, build, [
      'visits-last',
      'visits-wide',
      'visits-narrow',
      'visits-mean',
      'visits-week',
      'visits-steady',
      'visits-not-a-number',
      'visits-allocating',
    ]);

    expect(await sent(playbook, build, 'orders-last')).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The build has its 8 candidates',
    });
  });
});

describe('candidates a trainer uploads to a build at once', () => {
  it('are taken once when they are the same bytes, both answered alike', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);

    const both = await Promise.all([sent(playbook, build, 'visits-mean'), sent(playbook, build, 'visits-mean')]);

    expect(both.map((answer) => answer.status)).toEqual(['succeeded', 'succeeded']);
    expect((await workOf(playbook, build)).map(({ type }) => type)).toEqual([
      'dataset_assembled',
      'candidate_uploaded',
    ]);
  });

  it('take the eighth candidate once, and refuse another that arrived beside it', async () => {
    const playbook = buildPlaybook();
    const build = await waitingBuild(playbook);
    await uploaded(playbook, build, [
      'visits-last',
      'visits-wide',
      'visits-narrow',
      'visits-mean',
      'visits-week',
      'visits-steady',
      'visits-not-a-number',
    ]);

    const both = await Promise.all([sent(playbook, build, 'visits-allocating'), sent(playbook, build, 'visits-even')]);

    expect(both.map(({ status }) => status).toSorted()).toEqual(['rejected', 'succeeded']);
    expect(both.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: 'conflict',
      detail: 'The build took its 8 candidates meanwhile',
    });
  });
});
