import { describe, expect, it } from 'vitest';

import { errorType } from '../dsl/raised-error.ts';
import { drivenRun, outputKindsIn, stepsIn } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

describe('a set task', () => {
  it('gives the values it sets, evaluated on its input', () => {
    const { outcome } = drivenRun(workflow('do:\n  - greet: { set: { greeting: \'${ "Hello, " + $data.name }\' } }'), {
      input: { name: 'Ada' },
    });

    expect(outcome).toEqual({ kind: 'completed', output: { greeting: 'Hello, Ada' } });
  });
});

describe('a switch task', () => {
  const document = workflow(`
do:
  - route:
      switch:
        - big: { when: '\${ $data.size > 10 }', then: large }
        - other: { then: small }
  - small: { set: { size: small }, then: end }
  - large: { set: { size: large } }
`);

  it('goes to the first case whose condition holds', () => {
    expect(drivenRun(document, { input: { size: 20 } }).outcome).toEqual({
      kind: 'completed',
      output: { size: 'large' },
    });
  });

  it('goes to the case with no condition when none holds', () => {
    expect(drivenRun(document, { input: { size: 2 } }).outcome).toEqual({
      kind: 'completed',
      output: { size: 'small' },
    });
  });

  it('goes on to the next task when no case matches, with its input', () => {
    const onlyGuarded = workflow(`
do:
  - route:
      switch:
        - big: { when: '\${ $data.size > 10 }', then: end }
  - after: { set: { went: on } }
`);

    expect(drivenRun(onlyGuarded, { input: { size: 2 } }).outcome).toEqual({
      kind: 'completed',
      output: { went: 'on' },
    });
  });
});

describe('a switch task that goes nowhere', () => {
  it('raises a configuration error when then names no task of its list', () => {
    const lost = workflow('do:\n  - route: { switch: [{ any: { then: nowhere } }] }');

    expect(drivenRun(lost).outcome).toEqual({
      kind: 'raised',
      error: {
        type: errorType('configuration'),
        status: 400,
        title: 'then: nowhere names no task in the same list',
        instance: '/do/0/route',
      },
    });
  });
});

describe('a raise task', () => {
  it('raises the error it defines, evaluated on its input', () => {
    const document = workflow(`
do:
  - refuse:
      raise:
        error: { type: https://example.com/refused, status: 422, title: Refused, detail: '\${ $data.why }' }
`);

    expect(drivenRun(document, { input: { why: 'too late' } }).outcome).toEqual({
      kind: 'raised',
      error: {
        type: 'https://example.com/refused',
        status: 422,
        title: 'Refused',
        detail: 'too late',
        instance: '/do/0/refuse',
      },
    });
  });

  it('raises an error the document names under use.errors', () => {
    const document = workflow(`
use:
  errors:
    late: { type: https://example.com/late, status: 408 }
do:
  - refuse: { raise: { error: late } }
`);

    expect(drivenRun(document).outcome).toEqual({
      kind: 'raised',
      error: { type: 'https://example.com/late', status: 408, instance: '/do/0/refuse' },
    });
  });

  it('raises a configuration error when the error it names has no type and status', () => {
    const document = workflow("do:\n  - refuse: { raise: { error: '${ {} }' } }");

    expect(drivenRun(document).outcome).toMatchObject({
      kind: 'raised',
      error: { status: 400, title: 'raise names no error with a type and a status', instance: '/do/0/refuse' },
    });
  });
});

describe('a wait task', () => {
  it('arms a timer for the time it waits and goes on with its input when the timer fires', () => {
    const { outcome, ended, events, driver } = drivenRun(
      workflow('do:\n  - pause: { wait: PT1H }\n  - after: { set: { waited: true } }'),
    );

    expect(outcome).toEqual({ kind: 'completed', output: { waited: true } });
    expect(driver.clock.now() - ended.startedAt).toBe(3_600_000);
    expect(outputKindsIn(events)).toEqual(['arm_timer', 'arm_timer', 'cancel_timer', 'settle']);
    expect(
      stepsIn(events)
        .filter(({ reference }) => reference === '/do/0/pause')
        .map((step) => step.outcome),
    ).toEqual(['waiting', 'completed']);
  });
});

describe('a raise task that names a kind and a because', () => {
  it('raises the kind and because it defines, as an error it caught carried them', () => {
    const document = workflow(`
do:
  - again:
      raise:
        error: { type: https://example.com/unfinished, status: 503, kind: tools_unfinished, because: '\${ $data.why }' }
`);

    expect(drivenRun(document, { input: { why: 'run_bound' } }).outcome).toEqual({
      kind: 'raised',
      error: {
        type: 'https://example.com/unfinished',
        status: 503,
        instance: '/do/0/again',
        kind: 'tools_unfinished',
        because: 'run_bound',
      },
    });
  });
});
