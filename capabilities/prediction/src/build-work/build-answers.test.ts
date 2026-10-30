import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildPlaybook, type BuildPlaybook } from '../build-testing/build-playbook.ts';
import { answered, askedBuild, builtFrom, modelFactsOf, savedFunction } from '../build-testing/built-versions.ts';
import { candidateSha256, uploaded } from '../runtime-testing/scripted-candidates.ts';
import { uploadedDailyVisits } from '../testing/daily-documents.ts';
import { dailyRows, steadyVisits } from '../testing/daily-rows.ts';

const someText: unknown = expect.any(String);

const someBytes: unknown = expect.any(Number);

const features = Array.from(
  { length: 40 },
  (_, at) => `the_share_of_the_visits_that_came_from_the_stores_of_region_${String(at).padStart(2, '0')}`,
);

function withFeatures(text: string): string {
  const lines = text.split('\r\n');
  return lines
    .map((line, at) => {
      if (at === 0) {
        return [line, ...features].join(',');
      }
      return [line, ...features.map((_, column) => (at === lines.length - 1 && column === 0 ? '' : '0'))].join(',');
    })
    .join('\r\n');
}

async function builtVersionWithFeatures(playbook: BuildPlaybook): Promise<void> {
  const base = dailyRows('visits', ['north', 'south'], 40, (series, day) =>
    day === 0 ? null : steadyVisits(series, day),
  );
  const text = `${withFeatures(base.text.trimEnd())}\r\n`;
  const rows = { text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
  const source = uploadedDailyVisits(rows.sha256).replace(
    '  window: 24',
    `  features: [${features.join(', ')}]\n  given: [${features.slice(0, 8).join(', ')}]\n  window: 24`,
  );
  await savedFunction(playbook, { rows, source });
  await builtFrom(playbook, ['visits-many-features']);
}

describe('the answer to a build', () => {
  it('is refused naming a candidate that was not uploaded, and a recipe past 8 KiB', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    const unknown = 'f'.repeat(64);

    expect(await answered(playbook, build, { candidates: [unknown], recipe: 'x'.repeat(9000) })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        { pointer: '/answer/candidates/0', detail: 'Candidate ffffffffffff… was not uploaded to this build' },
        {
          pointer: '/answer/recipe',
          detail: 'The recipe takes 9,000 bytes, more than the 8,192 an answer may give it',
        },
      ],
    });
  });

  it('is taken once: the same answer again records nothing, and another is a conflict', async () => {
    const playbook = buildPlaybook();
    await savedFunction(playbook);
    const build = await askedBuild(playbook);
    await uploaded(playbook, build, ['visits-mean']);
    const answer = { candidates: [candidateSha256('visits-mean')] };
    const first = await answered(playbook, build, answer);

    expect([
      await answered(playbook, build, answer),
      await answered(playbook, build, { candidates: [] }),
    ]).toMatchObject([first, { status: 'rejected', reason: 'conflict' }]);
  });
});

describe('the card of a version', () => {
  it('keeps its features as content when they would take it past 4 KiB', async () => {
    const playbook = buildPlaybook();
    await builtVersionWithFeatures(playbook);

    expect((await modelFactsOf(playbook))[0]?.data).toMatchObject({
      features_sha256: someText,
      features_bytes: someBytes,
    });
    expect((await modelFactsOf(playbook))[0]?.data).not.toHaveProperty('features');
  });
});
