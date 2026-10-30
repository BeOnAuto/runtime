import { describe, expect, it } from 'vitest';

import { testFunctions } from '../testing/driver-inputs.ts';
import { header, workflow, yamlObject } from '../testing/workflows.ts';
import { field, isObject, type Json } from './json.ts';
import type { Rejection } from './policy-checks.ts';
import { policyOf } from './policy.ts';

const rejectionsOf = policyOf(testFunctions);

function pointersRejectedIn(source: string): readonly string[] {
  return rejectionsOf(workflow(source)).map(({ pointer }) => pointer);
}

const allowed = workflow(`
use:
  errors:
    late: { type: https://example.com/late, status: 408 }
  retries:
    patient: { delay: PT1S, backoff: { exponential: {} }, limit: { attempt: { count: 3 } } }
  timeouts:
    short: { after: PT5S }
input:
  from: $data.order
  schema:
    format: json:2020-12
    document: { type: object }
do:
  - check:
      if: $data.total > 0
      set: { total: '\${ $data.total }' }
      timeout: short
      then: done
  - done:
      raise:
        error: late
timeout:
  after: PT1H
output:
  as: '\${ ({ total: $data.total }) }'
`);

describe('the policy of a document', () => {
  it('allows a workflow of the tasks this runtime runs', () => {
    expect(rejectionsOf(allowed)).toEqual([]);
  });

  it('evaluates its expressions as TypeScript in strict mode, the defaults, and refuses another language or mode', () => {
    expect(rejectionsOf(workflow('evaluate: { language: typescript, mode: strict }\ndo: []'))).toEqual([]);
    expect(rejectionsOf(workflow('evaluate: { language: python, mode: loose }\ndo: []'))).toEqual([
      {
        pointer: '/evaluate/language',
        detail: "The playbook's one language is TypeScript; write the program as a TypeScript function",
        forbidden: true,
      },
      {
        pointer: '/evaluate/mode',
        detail: 'An expression that fails must fail, so evaluate.mode is strict, the default',
        forbidden: true,
      },
    ]);
  });

  it('runs documents of DSL 1.0.x only', () => {
    expect(rejectionsOf({ document: { ...header, dsl: '0.9.0' }, do: [] })).toEqual([
      { pointer: '/document/dsl', detail: 'This runtime runs documents of DSL 1.0.x, not 0.9.0', forbidden: true },
    ]);
    expect(rejectionsOf({ do: [] })).toEqual([
      {
        pointer: '/document/dsl',
        detail: 'This runtime runs documents of DSL 1.0.x, not an unnamed version',
        forbidden: true,
      },
    ]);
  });
});

describe('the reusable components of a document', () => {
  it('are rejected when this version does not support them', () => {
    expect(
      pointersRejectedIn(`
use:
  authentications: {}
  secrets: [token]
  catalogs: {}
  extensions: []
  functions: {}
do: []
`),
    ).toEqual(['/use/authentications', '/use/secrets', '/use/catalogs', '/use/extensions', '/use/functions']);
  });

  it('are checked when they are retries and timeouts, whose expressions the check at save reads', () => {
    expect(
      pointersRejectedIn(`
use:
  retries:
    broken: { delay: soon, when: '$data.a +', jitter: { from: PT1S, to: P1M } }
    ignored: 3
  timeouts:
    broken: { after: never }
    computed: { after: '\${ $data.after }' }
    ignored: 3
  errors:
    computed: { type: '\${ $data.type }', status: 500 }
do: []
`),
    ).toEqual(['/use/retries/broken/delay', '/use/retries/broken/jitter/to', '/use/timeouts/broken/after']);
  });
});

function refusingAfter(schedule: Json, pointer: string): readonly Rejection[] {
  return isObject(schedule) && field(schedule, 'after') !== undefined
    ? [{ pointer: `${pointer}/after`, detail: 'after is refused', forbidden: true }]
    : [];
}

describe('the data of a document', () => {
  it('has no schedule and a well-formed timeout', () => {
    expect(
      pointersRejectedIn(`
schedule: { every: PT1H }
input:
  from: $data.a
output:
  as: { total: '\${ $data.total }' }
timeout: missing
do: []
`),
    ).toEqual(['/schedule', '/timeout']);
  });

  it('has its schedule checked by the functions it is given, when they check one', () => {
    const checking = policyOf({ ...testFunctions, scheduleRejections: refusingAfter });

    expect([
      checking(workflow('schedule: { every: PT1H }\ndo: []')),
      checking(workflow('schedule: { after: PT1H }\ndo: []')),
    ]).toEqual([[], [{ pointer: '/schedule/after', detail: 'after is refused', forbidden: true }]]);
  });

  it('checks an inline workflow timeout', () => {
    expect(pointersRejectedIn('timeout: { after: P1Y }\ndo: []')).toEqual(['/timeout/after']);
  });

  it('is read without breaking when its parts are not what the DSL says', () => {
    expect(rejectionsOf(yamlObject(`document: { dsl: '1.0.3' }\nuse: 3\ndo: { not: a list }\ninput: 3`))).toEqual([]);
  });
});

describe('the schemas of a document', () => {
  it('are inline JSON Schemas only', () => {
    expect(
      pointersRejectedIn(`
input:
  schema:
    resource: { endpoint: https://example.com/schema.json }
output:
  schema:
    format: avro
    document: {}
do: []
`),
    ).toEqual(['/input/schema/resource', '/output/schema/format']);
  });

  it('may leave out their format', () => {
    expect(rejectionsOf(workflow('input: { schema: { document: { type: object } } }\ndo: []'))).toEqual([]);
  });
});
