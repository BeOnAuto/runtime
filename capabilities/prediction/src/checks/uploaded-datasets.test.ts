import type { SavedDefinitions } from '@on.auto/definitions';
import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { predictionRuns, savedInPlaybook } from '../testing/prediction-runs.ts';
import { uploadedWeeklyOrders } from '../testing/weekly-orders.ts';

const digest = 'c'.repeat(64);

const named = `${'c'.repeat(12)}…`;

const uploaded = uploadedWeeklyOrders(digest);

const weeks = 'series,period,orders,basket,promotion\r\nnorth,2026-W40,2,30,1\r\nnorth,2026-W41,0,,\r\n';

function keptAs(text: string, mediaType = 'text/csv'): SavedDefinitions {
  return savedInPlaybook([], new Map([[digest, { text, mediaType }]]));
}

async function checked(saved: SavedDefinitions): Promise<unknown> {
  const exit = await Effect.runPromiseExit(predictionRuns().prepared(uploaded).check(saved));
  return Exit.isFailure(exit) ? Cause.squash(exit.cause) : exit.value;
}

function problems(...details: readonly string[]): unknown {
  return expect.objectContaining({ issues: details.map((detail) => ({ pointer: '', detail })) });
}

const notADataset = `Line 10, /data/dataset: What this playbook keeps under ${named} is not a dataset uploaded as CSV`;

const notDatasets: readonly (readonly [string, string, string])[] = [
  ['content of another media type', weeks, 'application/json'],
  ['a header and no row', 'series,period,orders,basket,promotion', 'text/csv'],
  ['a header that does not start with series,period', 'region,week,orders\r\nnorth,2026-W40,2\r\n', 'text/csv'],
  ['a period in no form of a grain', 'series,period,orders\r\nnorth,last week,2\r\n', 'text/csv'],
  ['a quote inside a field', 'series,period,orders\r\nno"rth,2026-W40,2\r\n', 'text/csv'],
  ['nothing', '', 'text/csv'],
];

describe('the check of an uploaded dataset when a prediction function is saved', () => {
  it('takes a dataset the playbook keeps, by the grain the function predicts, with its target and its features in order', async () => {
    expect(await checked(keptAs(weeks))).toEqual({});
  });

  it('refuses a digest the playbook keeps no dataset under, naming its line', async () => {
    expect(await checked(savedInPlaybook([]))).toEqual(
      problems(`Line 10, /data/dataset: This playbook keeps no dataset under ${named}; upload it first, then name it`),
    );
  });

  it.each(notDatasets)('refuses what is not a dataset uploaded as CSV, such as %s', async (_case, text, mediaType) => {
    expect(await checked(keptAs(text, mediaType))).toEqual(problems(notADataset));
  });

  it('refuses a dataset of another grain, another target or other features, each at its line', async () => {
    expect(await checked(keptAs('series,period,sales,price,promotion\r\nnorth,2026-10-05,2,30,1\r\n'))).toEqual(
      problems(
        `Line 4, /predicts/target: The dataset uploaded under ${named} names its target sales after series,period, not orders`,
        `Line 5, /predicts/period: The dataset uploaded under ${named} holds a row for each day, not each week; predict the grain it holds`,
        `Line 12, /data/features: The dataset uploaded under ${named} has the features price, promotion after its target, in that order; name its features so`,
      ),
    );
    expect(await checked(keptAs('series,period,orders\r\nnorth,2026-W40,2\r\n'))).toEqual(
      problems(
        `Line 12, /data/features: The dataset uploaded under ${named} has no features after its target, in that order; name its features so`,
      ),
    );
  });

  it('fails when the content it keeps cannot be read', async () => {
    const failing: SavedDefinitions = {
      ...savedInPlaybook([]),
      content: () =>
        Effect.succeed({
          stream: new ReadableStream<Uint8Array>({
            pull: (controller) => {
              controller.error(new Error('The store stopped answering'));
            },
          }),
          bytes: 1,
          mediaType: 'text/csv',
        }),
    };

    expect(Exit.hasDies(await Effect.runPromiseExit(predictionRuns().prepared(uploaded).check(failing)))).toBe(true);
  });
});
