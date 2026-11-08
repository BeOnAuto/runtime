import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AnswerCheckReport, CaseReport, CheckOutcome } from '@on.auto/reasoning';

import { everyModelPassed, runAnswerCheck } from './answer-check.ts';

const gateway = {
  MODEL_GATEWAYS: JSON.stringify([
    { name: 'gateway', base_url: 'https://gateway.example/v1', structured_outputs: true },
  ]),
};

function notServed(): Promise<Response> {
  const body = JSON.stringify({ error: { message: 'no such model', type: null, param: null, code: '404' } });
  return Promise.resolve(new Response(body, { status: 404, headers: { 'content-type': 'application/json' } }));
}

function reportOf(...outcomes: readonly CheckOutcome[]): AnswerCheckReport {
  const canary: CaseReport = { case: 'seventeen_unions', kind: 'canary', outcome: 'schema_refused', duration_ms: 1 };
  return {
    checked_at: '2026-11-08T03:00:00.000Z',
    models: outcomes.map((outcome, index) => ({ model: `gateway/model-${index}`, outcome, cases: [canary] })),
  };
}

await test('the command asks for at least one model, and takes no options', async () => {
  await assert.rejects(runAnswerCheck([], gateway), /^Error: Usage: pnpm answer-check <provider\/model>/u);
  await assert.rejects(runAnswerCheck(['--all'], gateway), /^Error: Usage/u);
});

await test('the command reads the model settings as the server does, and stops on settings that are invalid', async () => {
  await assert.rejects(
    runAnswerCheck(['gateway/model'], { MODEL_GATEWAYS: '[{"name":"Gateway","base_url":"https://gateway.example"}]' }),
    /The model settings are invalid/u,
  );
});

await test('the command asks every case of every model through the model access, and reports each', async () => {
  const report = await runAnswerCheck(['gateway/retired', 'gateway/gone'], gateway, { fetch: notServed });
  assert.deepEqual(
    report.models.map(({ model, outcome }) => `${model} ${outcome}`),
    ['gateway/retired unreachable', 'gateway/gone unreachable'],
  );
  assert.deepEqual(
    report.models[0]?.cases.map(({ case: name, kind, status }) => `${kind} ${name} ${String(status)}`),
    [
      'portable categories 404',
      'portable series 404',
      'portable table 404',
      'portable text 404',
      'portable reference 404',
      'described described 404',
      'tools tools 404',
      'canary seventeen_unions 404',
      'canary large_max_items 404',
    ],
  );
  assert.equal(everyModelPassed(report), false);
});

await test('a run passes when every model passed, after a correction or not, whatever its canaries found', () => {
  assert.equal(everyModelPassed(reportOf('passed', 'passed_after_repair')), true);
  const failing: readonly CheckOutcome[] = ['invalid', 'schema_refused', 'unavailable', 'unreachable'];
  for (const outcome of failing) {
    assert.equal(everyModelPassed(reportOf('passed', outcome)), false);
  }
});
