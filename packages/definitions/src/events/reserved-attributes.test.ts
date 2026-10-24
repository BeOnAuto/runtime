import { Result, Schema, SchemaIssue } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { asking, nudgesPresenter } from '../testing/asking.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { playbookOwnNamesOf, isReservedSource } from './reserved-attributes.ts';

const { types, refusingThePlaybooksOwnAttributes } = playbookOwnNamesOf([echo, asking]);

const EventSchema = Schema.StructWithRest(
  Schema.Struct({ type: Schema.String, source: Schema.optionalKey(Schema.String) }),
  [Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Int]))],
).check(refusingThePlaybooksOwnAttributes);

const decode = Schema.decodeUnknownResult(EventSchema, { errors: 'all' });

function refusals(event: unknown): readonly string[] {
  const decoded = decode(event);
  return Result.isSuccess(decoded)
    ? []
    : SchemaIssue.makeFormatterStandardSchemaV1()(decoded.failure.issue).issues.map(
        ({ message, path = [] }) => `/${path.map(String).join('/')}: ${message}`,
      );
}

const typesOfThePlaybook = [
  'run_started',
  'run_deferred',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  'run_cancel_requested',
  'tool_call_started',
  'tool_call_answered',
  'tool_call_failed',
  'model_call_started',
  'model_call_answered',
  'model_call_failed',
  'request_answered',
  'nudge_sent',
  'asking_requested',
  'nudge_read',
  'definition_created',
  'definition_updated',
  'definition_retired',
  'event_published',
  'reaction_refused',
];

describe('the types and sources of what the playbook records itself', () => {
  it('are reserved for the playbook: every type its runs and definitions record, those its capabilities declare, and every type its feed shows', () => {
    expect([...types]).toEqual(typesOfThePlaybook);
    const shown = makeDefinitionPresenters([echo, asking]).flatMap(({ publicNames }) =>
      Object.values(publicNames).flat(),
    );
    expect(shown.filter((name) => !types.has(name))).toEqual([]);
    expect(
      ['/runs/1', '/definitions/reasoning/summary', '/callers/acme-admin', '/runs', 'runs/1', '/ledger/eu'].map(
        (source) => isReservedSource(source),
      ),
    ).toEqual([true, true, true, false, false, false]);
  });

  it('are none of a capability beyond the playbook’s own when no capability declares a fact', () => {
    expect([...playbookOwnNamesOf([echo]).types].filter((type) => !types.has(type))).toEqual([]);
    expect([...playbookOwnNamesOf([echo]).types]).not.toContain('nudge_sent');
  });

  it('are those of facts declared before their capability is made, which say no words of a deferral', () => {
    const declared = playbookOwnNamesOf([echo, { type: 'nudging', facts: { onRuns: [], streams: [nudgesPresenter] } }]);

    expect([...declared.types].filter((type) => !playbookOwnNamesOf([echo]).types.has(type))).toEqual(['nudge_read']);
  });

  it('are refused in an event from outside, each where it is given', () => {
    expect(refusals({ type: 'run_succeeded', source: '/runs/0199a3c4' })).toEqual([
      `/type: Expected a type of your own, not one the playbook records itself: ${typesOfThePlaybook.join(', ')}`,
      '/source: Expected a source of your own, not one under /runs/, /definitions/ or /callers/, which the playbook records itself',
    ]);
    expect(
      [
        'run_deferred',
        'tool_call_started',
        'model_call_answered',
        'request_answered',
        'nudge_sent',
        'nudge_read',
        'asking_requested',
        'event_published',
        'reaction_refused',
      ].map((type) => refusals({ type }).length),
    ).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(refusals({ type: 'com.acme.ledger.month-closed', source: '/ledger/eu' })).toEqual([]);
  });
});

const reservedInWords =
  'causationid, correlationid, caller, definitionversion, depth, calldepth, calledby, triggerkind and triggerreference are the lineage and context the playbook gives its own records, which no event may claim';

describe('the lineage and the context the playbook gives its own records', () => {
  it('are refused in an event from outside, which may not claim them', () => {
    expect(refusals({ type: 'com.acme.approved', causationid: 'm-1', correlationid: 'r-1' })).toEqual([
      `/causationid: Expected no causationid: ${reservedInWords}`,
      `/correlationid: Expected no correlationid: ${reservedInWords}`,
    ]);
  });

  it('are refused for each attribute of the context of a run, so no event can claim a caller or a depth', () => {
    const claimed = {
      type: 'com.acme.approved',
      caller: 'acme-admin',
      definitionversion: 2,
      depth: 1,
      calldepth: 1,
      calledby: 'r-0',
      triggerkind: 'event',
      triggerreference: '/schedule/on',
    };

    expect(refusals(claimed).map((refusal) => refusal.slice(0, refusal.indexOf(':')))).toEqual([
      '/caller',
      '/definitionversion',
      '/depth',
      '/calldepth',
      '/calledby',
      '/triggerkind',
      '/triggerreference',
    ]);
  });
});
