import { runtimeAttributeTypes } from '@on.auto/workflow-engine';
import { Result, Schema, SchemaIssue } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { asking, nudgesPresenter } from '../testing/asking.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { playbookOwnNamesOf, isReservedSource } from './reserved-attributes.ts';

const { types, refusingThePlaybooksOwnAttributes } = playbookOwnNamesOf([echo, asking]);

const EventSchema = Schema.StructWithRest(
  Schema.Struct({ type: Schema.String, source: Schema.optionalKey(Schema.String) }),
  [Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Int, Schema.Boolean]))],
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
  'attempt_resumed',
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
  'definition_paused',
  'definition_resumed',
  'definition_restored',
  'definition_moved',
  'definition_renamed',
  'playbook_page_saved',
  'playbook_goals_saved',
  'playbook_goals_agreed',
  'goal_created',
  'goal_updated',
  'goal_reordered',
  'goal_agreed',
  'goal_removed',
  'goal_renamed',
  'playbook_import_started',
  'playbook_imported',
  'event_published',
  'reaction_refused',
];

describe('the sources of what the playbook records itself', () => {
  it('are those under /runs/, /definitions/, /callers/ and /connections/, the last the source of what a connected app reports', () => {
    expect(
      [
        '/runs/1',
        '/definitions/reasoning/summary',
        '/callers/acme-admin',
        '/connections/tracker',
        '/runs',
        'runs/1',
        '/connection/tracker',
        '/ledger/eu',
      ].map((source) => isReservedSource(source)),
    ).toEqual([true, true, true, true, false, false, false, false]);
  });
});

describe('the types and sources of what the playbook records itself', () => {
  it('are reserved for the playbook: every type its runs and definitions record, those its capabilities declare, and every type its feed shows', () => {
    expect([...types]).toEqual(typesOfThePlaybook);
    const shown = makeDefinitionPresenters([echo, asking]).flatMap(({ publicNames }) =>
      Object.values(publicNames).flat(),
    );
    expect(shown.filter((name) => !types.has(name))).toEqual([]);
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
      expect.stringMatching(/^\/source: /u),
    ]);
    expect(refusals({ type: 'com.example.item.added', source: '/connections/tracker' })).toEqual([
      expect.stringMatching(/^\/source: /u),
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

function refusedAt(event: unknown): readonly string[] {
  return refusals(event).map((refusal) => refusal.slice(0, refusal.indexOf(':')));
}

describe('the lineage and the context the playbook gives its own records', () => {
  it('are refused in an event from outside, which may not claim them', () => {
    expect(refusedAt({ type: 'com.acme.approved', causationid: 'm-1', correlationid: 'r-1' })).toEqual([
      '/causationid',
      '/correlationid',
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
      automatic: true,
    };

    expect(refusedAt(claimed)).toEqual([
      '/caller',
      '/definitionversion',
      '/depth',
      '/calldepth',
      '/calledby',
      '/triggerkind',
      '/triggerreference',
      '/automatic',
    ]);
  });

  it('are the attributes a filter types as the runtime declares them, one list, each refused where it is given', () => {
    const declared = [...runtimeAttributeTypes.keys()];

    expect(declared.map((name) => refusedAt({ type: 'com.acme.approved', [name]: true }))).toEqual(
      declared.map((name) => [`/${name}`]),
    );
  });
});
