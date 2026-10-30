import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf, pageOf } from '../testing/servers/tutorial-calls.ts';
import { askedBuild, endedRun, standingWhen } from './build-calls.ts';
import { uploaded } from './dataset-uploads.ts';

const testTimeoutMs = 90_000;

const tutorial = 'tutorials/first-forecast.md';

const blocks = blocksInOrderOf(tutorial);

function blockHolding(language: string, holding: string): string {
  return String(blocks.find((block) => block.language === language && block.body.includes(holding))?.body);
}

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const ScoresSchema = Schema.Array(Schema.Struct({ horizon: Schema.Number, pairs: Schema.Number, mase: Schema.Number }));

const EventsSchema = Schema.Struct({
  events: Schema.Array(Schema.Struct({ type: Schema.String, data: Schema.Unknown })),
});

const CardSchema = Schema.Struct({
  scores: ScoresSchema,
  baselines: Schema.Tuple([Schema.Struct({ baseline: Schema.Literal('persistence'), scores: ScoresSchema })]),
});

const FittedSchema = Schema.fromJsonString(Schema.Struct({ candidates: Schema.Array(Schema.String) }));

const SignatureSchema = Schema.Struct({ signature: Schema.Struct({ recipe: Schema.String }) });

const horizonWords: Readonly<Record<number, string>> = { 1: '1 week', 4: '4 weeks' };

function cardRowsOnThePage(): readonly (readonly string[])[] {
  return pageOf(tutorial)
    .split('\n')
    .filter((line) => Object.values(horizonWords).some((words) => line.startsWith(`| ${words} `)))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function eventsOf(path: string): Promise<readonly { readonly type: string; readonly data: unknown }[]> {
  const { body } = await server.call('GET', path);
  return Schema.decodeUnknownSync(EventsSchema)(body).events;
}

function question(): Promise<{ readonly status: number; readonly body: unknown }> {
  return server.call('POST', `${alpha}/definitions/prediction/weekly-signups/run`, {
    body: { input: { series: 'north', horizon: 1 } },
  });
}

type Card = typeof CardSchema.Type;

function cardRowsOf(card: Card): readonly (readonly string[])[] {
  return card.scores.map(({ horizon, pairs, mase }, at) => [
    String(horizonWords[horizon]),
    String(pairs),
    String(mase),
    String(card.baselines[0].scores[at]?.mase),
  ]);
}

async function fittedBy(build: string): Promise<unknown> {
  const work = await eventsOf(`${alpha}/runs/${build}/history`);
  return {
    fitted: work.find(({ type }) => type === 'candidates_fitted')?.data,
    recipes: work
      .filter(({ type }) => type === 'candidate_uploaded')
      .map(({ data }) => Schema.decodeUnknownSync(SignatureSchema)(data).signature.recipe),
  };
}

async function exampleRun() {
  server = await servingReasoning([], { WORKFLOW_SWEEP_INTERVAL: 'PT0.05S' });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const upload = await uploaded(server.origin, blockHolding('csv', 'series,period,signups'));
  const created = await server.call('POST', `${alpha}/definitions/prediction`, {
    body: { name: 'weekly-signups', source: blockHolding('markdown', 'target: signups') },
  });
  const before = await question();
  const build = await askedBuild(server, 'weekly-signups');
  const ended = await endedRun(server, build);
  await standingWhen(server, 'weekly-signups', { models: { active: { version: 1 } }, build: null });
  const [built] = await eventsOf(`${alpha}/events?type=version_built`);
  return {
    upload,
    created: created.status,
    before,
    ended,
    work: await fittedBy(build),
    card: Schema.decodeUnknownSync(CardSchema)(built?.data),
    after: await question(),
  };
}

describe('the developer example of a forecast, run on the runtime’s own models', { timeout: testTimeoutMs }, () => {
  it('takes the upload, answers the default forecast, builds and activates the drift, and answers the forecast the page shows', async () => {
    const ran = await exampleRun();

    expect([ran.upload, ran.created]).toEqual([
      { status: 200, body: decodeJson(blockHolding('json', '"dataset"')) },
      201,
    ]);
    expect(ran.before).toMatchObject({
      status: 200,
      body: {
        output: { lines: [{ name: 'observed' }, { name: 'predicted', points: [{ value: 206 }] }] },
        record: { version: null, default_forecast: true },
      },
    });
    expect(ran.ended).toMatchObject({ status: 'succeeded', output: decodeJson(blockHolding('json', '"winner"')) });
    expect(ran.work).toMatchObject({
      fitted: {
        runtime: { name: 'series' },
        candidates: Schema.decodeUnknownSync(FittedSchema)(blockHolding('json', '"runtime"')).candidates,
      },
      recipes: ['mean', 'drift', 'linear'],
    });
    expect(cardRowsOnThePage()).toEqual(cardRowsOf(ran.card));
    expect(ran.after).toMatchObject({
      status: 200,
      body: {
        output: decodeJson(blockHolding('json', '"lines"')),
        record: { version: 1, runtime: { name: 'series' } },
      },
    });
  });
});
