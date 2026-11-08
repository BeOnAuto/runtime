import { describe, expect, it } from 'vitest';

import { checkCases } from './check-cases.ts';
import {
  caseNames,
  caseOf,
  checked,
  everyCase,
  firstModelOf,
  modelChecked,
  outcomesOf,
  requestsWithTools,
  schemasSent,
  toolAnswersIn,
} from './check-harness.ts';
import { citiesSchema, contactCardSchema } from './check-schemas.ts';

describe('the cases of the answer check', () => {
  it('are the four shapes, the reference schema, a described case, a tools case and two canaries', () => {
    expect(checkCases.map(({ name, kind }) => `${kind} ${name}`)).toEqual([
      'portable categories',
      'portable series',
      'portable table',
      'portable text',
      'portable reference',
      'described described',
      'tools tools',
      'canary seventeen_unions',
      'canary large_max_items',
    ]);
  });

  it('ask for 4096 output tokens at most, as a definition may', async () => {
    const bodies = (await checked('scripted/passing')).sent();
    expect(bodies.map((body) => JSON.stringify(body)).filter((sent) => !sent.includes('"max_tokens":4096'))).toEqual(
      [],
    );
  });

  it('send a canary its schema as written, past the budget, and every other case its portable form', async () => {
    const sent = schemasSent((await checked('scripted/passing')).sent());
    expect(sent.slice(-2)).toEqual([contactCardSchema, citiesSchema]);
    expect(JSON.stringify(sent.slice(0, -2))).not.toContain('maxItems');
    expect(JSON.stringify(sent.slice(0, -2))).toContain('Must be at least 1 item; at most 200 items.');
  });

  it('give the tool its answers and ask again, with the calls and their results', async () => {
    expect(toolAnswersIn((await checked('scripted/passing')).sent())).toEqual([
      '"role":"tool","tool_call_id":"call_lille","content":"0.24"',
      '"role":"tool","tool_call_id":"call_lyon","content":"0.52"',
    ]);
  });
});

describe('a model that answers', () => {
  it('passes when it answers every case, enforced where the route takes schemas', async () => {
    const model = await modelChecked('scripted/passing');
    expect(model.outcome).toBe('passed');
    expect(outcomesOf(model)).toEqual(everyCase('passed'));
    expect(model.cases.map(({ output_mode: mode }) => mode)).toEqual([
      ...Array.from({ length: 5 }, () => 'portable'),
      'described',
      ...Array.from({ length: 3 }, () => 'portable'),
    ]);
    expect(caseOf(model, 'categories')).toEqual({
      case: 'categories',
      kind: 'portable',
      outcome: 'passed',
      output_mode: 'portable',
      cost_usd: 0.25,
    });
    expect(caseOf(model, 'tools')).toHaveProperty('cost_usd', 0.5);
    expect(Math.min(...model.cases.map(({ duration_ms: taken }) => taken))).toBeGreaterThanOrEqual(0);
  });

  it('passes after repair when its answers match only once corrected, showing what the first missed', async () => {
    const model = await modelChecked('scripted/repairing');
    expect(model.outcome).toBe('passed_after_repair');
    expect(outcomesOf(model)).toEqual(everyCase('passed_after_repair'));
    expect(caseOf(model, 'text')).toMatchObject({
      outcome: 'passed_after_repair',
      issues: [
        { pointer: '/answer', detail: 'Expected no excess property' },
        { pointer: '/text', detail: 'Missing key' },
      ],
      cost_usd: 0.5,
    });
    expect(caseOf(model, 'tools')).toHaveProperty('cost_usd', 0.75);
  });

  it('is described in every case through a gateway that takes no schemas, with no cost it does not answer', async () => {
    const model = await modelChecked('describing/passing');
    expect(model.outcome).toBe('passed');
    expect(model.cases.map(({ output_mode: mode, cost_usd: cost }) => `${String(mode)} ${String(cost)}`)).toEqual(
      caseNames.map(() => 'described undefined'),
    );
  });
});

describe('a model whose answers miss', () => {
  it('is invalid when its answers miss the schema after the correction', async () => {
    const model = await modelChecked('scripted/invalid');
    expect(model.outcome).toBe('invalid');
    expect(outcomesOf(model)).toEqual(everyCase('invalid'));
    expect(caseOf(model, 'categories')).toEqual({
      case: 'categories',
      kind: 'portable',
      outcome: 'invalid',
      output_mode: 'portable',
      detail: 'The answer is not JSON',
      cost_usd: 0.5,
    });
    expect(caseOf(model, 'tools')).toMatchObject({
      outcome: 'invalid',
      detail: 'The answer is not JSON',
      cost_usd: 0.5,
    });
  });

  it('is invalid in the tools case when it answers without calling the tool it was told to call', async () => {
    const model = await modelChecked('scripted/tools-blocked');
    expect(model.outcome).toBe('invalid');
    expect(outcomesOf(model)).toEqual({ ...everyCase('passed'), tools: 'invalid' });
    expect(caseOf(model, 'tools')).toEqual({
      case: 'tools',
      kind: 'tools',
      outcome: 'invalid',
      output_mode: 'portable',
      detail: 'The model answered without calling city_population, which it was told to call',
      cost_usd: 0.25,
    });
  });

  it('is invalid in the tools case when it keeps calling tools, each call answered as it can be', async () => {
    const { report, sent } = await checked('scripted/looping');
    expect(caseOf(firstModelOf(report), 'tools')).toMatchObject({
      outcome: 'invalid',
      detail: 'The model still called tools after 3 requests, instead of answering',
      cost_usd: 0.75,
    });
    const asked = requestsWithTools(sent());
    expect(asked).toHaveLength(3);
    expect(asked[2]).toContain('"content":"No population is known for that city"');
  });
});

describe('the report of the answer check', () => {
  it('holds every model in the order asked, and when the check began', async () => {
    const { report } = await checked('scripted/missing', 'describing/passing', 'scripted/invalid');
    expect(report.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    expect(report.models.map(({ model, outcome }) => `${model} ${outcome}`)).toEqual([
      'scripted/missing unreachable',
      'describing/passing passed',
      'scripted/invalid invalid',
    ]);
  });
});
