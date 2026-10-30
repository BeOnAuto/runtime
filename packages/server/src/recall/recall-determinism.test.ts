import { randomUUID } from 'node:crypto';

import { recallDocument } from '@on.auto/recall/testing';
import { Schema } from 'effect';
import { Client } from 'pg';
import { describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import {
  playbookWithReviews,
  inState,
  liveWith,
  recalled,
  servingRecall,
  standingUntil,
  verdicts,
} from '../testing/servers/recall-server.ts';

const postgresql = process.env['LEDGER_TEST_POSTGRESQL_URL'] ?? '';

const secondStore = postgresql === '' ? 'SQLite, as LEDGER_TEST_POSTGRESQL_URL is not set' : 'PostgreSQL';

async function administer(statement: string): Promise<void> {
  const client = new Client({ connectionString: postgresql });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function onADatabaseOfItsOwn(): Promise<Readonly<Record<string, string>>> {
  const name = `recall_${randomUUID().replaceAll('-', '')}`;
  await administer(`CREATE DATABASE ${name}`);
  onTestFinished(async () => {
    await administer(`DROP DATABASE ${name} WITH (FORCE)`);
  });
  const database = new URL(postgresql);
  database.pathname = `/${name}`;
  return { LEDGER_FILE: '', DATABASE_URL: database.href, SECRETS_KEY: secretsKey };
}

function secondEnvironment(): Promise<Readonly<Record<string, string>>> {
  return postgresql === '' ? Promise.resolve({}) : onADatabaseOfItsOwn();
}

const reviewRuns =
  'language: typescript\nsource:\n  events:\n    - type: run_succeeded\n      subject: reasoning/review-brief';

const byCampaign = recallDocument(
  [
    'export function fold(view: any, event: any): any {',
    '  const output = event.data.output;',
    "  const isObject = typeof output === 'object' && output !== null && !Array.isArray(output);",
    "  const campaign = isObject && typeof output.campaign === 'string' ? output.campaign : 'unknown';",
    '  const given = isObject ? output.verdict : undefined;',
    "  const verdict = (typeof given === 'string' ? given : given === undefined ? 'none' : JSON.stringify(given)).slice(0, 20);",
    '  return { ...view, [campaign]: [...(view[campaign] ?? []), verdict] };',
    '}',
  ].join('\n'),
  `${reviewRuns}\nview:\n  initial: {}`,
);

const counted = recallDocument(
  [
    'export function fold(view: any, event: any): any {',
    '  const key = JSON.stringify(event.data.output);',
    '  return { ...view, [key]: (view[key] ?? 0) + 1 };',
    '}',
    '',
    'export function answer(view: any): any {',
    '  return Object.values(view).reduce((sum: number, count: any) => sum + count, 0);',
    '}',
  ].join('\n'),
  `${reviewRuns}\nview:\n  initial: {}`,
);

const depths = recallDocument(
  [
    'export function fold(view: any, event: any): any {',
    '  const depth = (left: number): number => (left === 0 ? 0 : depth(left - 1) + 1);',
    '  return [...view, depth(JSON.stringify(event.data.output).length)];',
    '}',
  ].join('\n'),
  `${reviewRuns}\nview:\n  initial: []`,
);

const outputs = [
  { campaign: 'spring', verdict: 'approve' },
  'a plain text answer',
  ['an', 'array'],
  { campaign: 7, verdict: 3 },
  { campaign: 'spring', verdict: 'x'.repeat(20_000) },
  { campaign: 'spring', verdict: 'reject' },
];

const decodeStanding = Schema.decodeUnknownSync(
  Schema.Struct({
    standing: Schema.Struct({
      folded: Schema.Number,
      stalled: Schema.Struct({ kind: Schema.String, line: Schema.NullOr(Schema.Number) }),
    }),
  }),
);

const decodeOutput = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Json }));

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

const decodeRecord = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Json, record: Schema.Struct({ work: Schema.Number }) }),
);

async function answeredBy(server: ReasoningServer, name: string) {
  const run = decodeRun((await recalled(server, name, {})).body).run_id;
  const { output, record } = decodeRecord((await server.call('GET', `${alpha}/runs/${run}`)).body);
  return { output, work: record.work };
}

async function viewsOn(server: ReasoningServer) {
  await playbookWithReviews(server, outputs.length);
  await server.call('POST', `${alpha}/definitions/recall`, { body: { name: 'campaigns', source: byCampaign } });
  await server.call('POST', `${alpha}/definitions/recall`, { body: { name: 'depths', source: depths } });
  await server.call('POST', `${alpha}/definitions/recall`, { body: { name: 'counted', source: counted } });
  await standingUntil(server, 'campaigns', liveWith(outputs.length));
  await standingUntil(server, 'counted', liveWith(outputs.length));
  const answers = { cold: await answeredBy(server, 'counted'), warm: await answeredBy(server, 'counted') };
  const stalled = decodeStanding(await standingUntil(server, 'depths', inState('stalled'))).standing;
  const campaigns = decodeOutput((await recalled(server, 'campaigns', {})).body).output;
  await server.stop();
  return { campaigns, depths: stalled, answers };
}

describe(`a recall function on a server on SQLite and on one on ${secondStore}`, () => {
  it('folds the same view from the same history, stops at the same event where its fold recurses past its fixed depth, and answers after the same work in a cold worker and a warm one', async () => {
    const second = await secondEnvironment();

    const onSQLite = await viewsOn(await servingRecall(verdicts(...outputs)));
    const onTheOther = await viewsOn(await servingRecall(verdicts(...outputs), second));

    expect(onTheOther).toEqual(onSQLite);
    expect(onSQLite.answers.warm).toEqual(onSQLite.answers.cold);
    expect(onSQLite.answers.cold.output).toBe(outputs.length);
    expect(onSQLite).toMatchObject({
      campaigns: { spring: ['approve', 'xxxxxxxxxxxxxxxxxxxx', 'reject'], unknown: ['none', 'none', '3'] },
      depths: { folded: 4, stalled: { kind: 'raised', line: 11 } },
    });
  });
});
