import { Effect, Option, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflow } from '../testing/workflows.ts';
import { callMarginMs, longestCallsOf, resumesAfterCallsOf } from './call-limits.ts';
import { attributesOfRun, type RunAttributes } from './run-attributes.ts';

const attributes: RunAttributes = {
  org: 'acme',
  playbook: 'accounts',
  run_id: 'run-1',
  definition: { name: 'payment', version: 2 },
  caller: {
    id: 'operator',
    name: 'operator',
    org: 'acme',
    permissions: ['org:read', 'org:write', 'playbook:read', 'playbook:write'],
    playbooks: ['accounts'],
  },
};

describe('the attributes of a workflow run', () => {
  it('reads the attributes the run was started with, its caller with them', () => {
    expect(attributesOfRun(attributes)).toEqual(Option.some(attributes));
  });

  it('reads the person a run acts for, which the run of a trigger names', () => {
    const actingForAda = {
      ...attributes,
      trigger: { kind: 'cron', reference: '/schedule/cron' },
      acts_for: 'person:ada',
    };

    expect(attributesOfRun(actingForAda)).toEqual(Option.some(actingForAda));
    expect(attributesOfRun({ ...attributes, acts_for: 7 })).toEqual(Option.none());
  });

  it('refuses a caller with an unknown permission or without its playbooks instead of granting access', () => {
    expect(attributesOfRun({ ...attributes, caller: { ...attributes.caller, permissions: ['admin'] } })).toEqual(
      Option.none(),
    );
    expect(attributesOfRun({ ...attributes, caller: { ...attributes.caller, playbooks: undefined } })).toEqual(
      Option.none(),
    );
    expect(attributesOfRun(null)).toEqual(Option.none());
  });
});

const longestRuns: Readonly<Record<string, number>> = {
  'reasoning/classify': 85_000,
  'workflow/review': 3_600_000,
};

function longestRunOf(type: string, name: string): Effect.Effect<number | undefined> {
  return Effect.succeed(longestRuns[`${type}/${name}`]);
}

const saved = { longestRunOf, longestRunFor: longestRunOf };

const document = workflow(`
do:
  - classify: { call: run_definition, with: { type: reasoning, name: classify } }
  - each:
      for: { in: '\${ $data.items }' }
      do:
        - review: { call: run_definition, with: { type: workflow, name: review } }
  - computed: { call: run_definition, with: { type: reasoning, name: '\${ $data.name }' } }
  - unsaved: { call: run_definition, with: { type: reasoning, name: summarize } }
  - plain: { call: run_definition, with: reasoning }
  - other: { call: notify, with: { type: reasoning, name: classify } }
  - pause: { wait: PT1M }
`);

describe('the longest call of each step of a workflow', () => {
  it('is the longest run of the definition it names, written out, with a minute of grace, wherever the step sits', async () => {
    expect(await Effect.runPromise(longestCallsOf(document, saved))).toEqual({
      '/do/0/classify': 85_000 + callMarginMs,
      '/do/1/each/do/0/review': 3_600_000 + callMarginMs,
    });
  });

  it('is left to the run-wide value for a definition computed at run time, one not saved, or another function', async () => {
    const limits = await Effect.runPromise(longestCallsOf(document, saved));

    expect(Object.keys(limits)).not.toContain('/do/2/computed');
    expect(Object.keys(limits)).not.toContain('/do/3/unsaved');
  });
});

const counting = workflow(`
do:
  - listed: { call: run_definition, with: { type: counting, name: items, input: [1, 2, { more: [3] }] } }
  - computed: { call: run_definition, with: { type: counting, name: items, input: [1, '\${ $data.next }'] } }
  - deeper: { call: run_definition, with: { type: counting, name: items, input: { items: [{ name: '\${ $data }' }] } } }
`);

const countingItems = {
  longestRunOf: () => Effect.succeed(600_000),
  longestRunFor: (_type: string, _name: string, input: Schema.Json) =>
    Effect.succeed(JSON.stringify(input).length * 1000),
};

const resumeIntervals: Readonly<Record<string, number>> = { 'reasoning/classify': 115_000 };

function resumesAfterOf(type: string, name: string): Effect.Effect<number | undefined> {
  return Effect.succeed(resumeIntervals[`${type}/${name}`]);
}

describe('the interval after which the run of each step of a workflow may be resumed', () => {
  it('is the one of the definition it names, written out, wherever the step sits, and none for a run that does not resume, one computed at run time or one not saved', async () => {
    expect(await Effect.runPromise(resumesAfterCallsOf(document, { resumesAfterOf }))).toEqual({
      '/do/0/classify': 115_000,
    });
  });
});

describe('the longest call of a step that gives the function its input written out', () => {
  it('is the longest run of that input, and the longest of any input when an expression computes any part of it', async () => {
    expect(await Effect.runPromise(longestCallsOf(counting, countingItems))).toEqual({
      '/do/0/listed': JSON.stringify([1, 2, { more: [3] }]).length * 1000 + callMarginMs,
      '/do/1/computed': 600_000 + callMarginMs,
      '/do/2/deeper': 600_000 + callMarginMs,
    });
  });
});
