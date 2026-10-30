import { presentedChangeCatalogOf, type Context, type PlacedFact } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { asking } from '../testing/asking.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { runChangedBy } from './changed-resources.ts';
import { makeDefinitionPresenters } from './definition-presenters.ts';

const catalog = presentedChangeCatalogOf(makeDefinitionPresenters([echo, asking]));

const acted = { at: '2026-10-05T09:00:00.000Z', by: 'ada' };

function factOf(stream: string, type: string, context: Context = acted): PlacedFact {
  return { id: `message-of-${type}`, stream, type, context };
}

function ofTheDefinition(definitionType: string): Context {
  return { ...acted, runId: 'r1', definitionType, definitionName: 'triage', definitionVersion: 1 };
}

const theRun = { kind: 'run', run_id: 'r1' };

const itsRequest = { kind: 'interaction', run_id: 'r1' };

describe('the changes the facts of a playbook make', () => {
  it('name a definition saved or retired by its type and name, and a run by its id', () => {
    expect([
      catalog.changesOf(factOf('definitions/echo', 'definition_created', ofTheDefinition('echo'))),
      catalog.changesOf(factOf('definitions/echo', 'definition_retired', ofTheDefinition('echo'))),
      catalog.changesOf(factOf('runs/r1', 'run_started', ofTheDefinition('echo'))),
      catalog.changesOf(factOf('runs/r1', 'run_deferred', ofTheDefinition('echo'))),
      runChangedBy(factOf('run-logs/r1', 'input_applied')),
    ]).toEqual([
      [{ kind: 'definition', type: 'echo', name: 'triage' }],
      [{ kind: 'definition', type: 'echo', name: 'triage' }],
      [theRun],
      [theRun],
      [theRun],
    ]);
  });

  it('name the run and its request for every fact of a run whose function asks, its expiry and its cancel among them', () => {
    expect([
      catalog.changesOf(factOf('runs/r1', 'run_deferred', ofTheDefinition('asking'))),
      catalog.changesOf(factOf('runs/r1', 'request_answered', ofTheDefinition('asking'))),
      catalog.changesOf(factOf('runs/r1', 'run_rejected', ofTheDefinition('asking'))),
      catalog.changesOf(factOf('runs/r1', 'run_cancel_requested', ofTheDefinition('asking'))),
    ]).toEqual([
      [theRun, itsRequest],
      [theRun, itsRequest],
      [theRun, itsRequest],
      [theRun, itsRequest],
    ]);
  });

  it('name an event published to the playbook or a refusal of its reactions by the id the feed lists it by', () => {
    expect([
      catalog.changesOf(factOf('events/e1', 'event_published')),
      catalog.changesOf(factOf('reactions/triage', 'reaction_refused')),
      catalog.kinds.map(({ kind }) => kind),
    ]).toEqual([
      [{ kind: 'event', event_id: 'message-of-event_published' }],
      [{ kind: 'event', event_id: 'message-of-reaction_refused' }],
      ['run', 'interaction', 'definition', 'event'],
    ]);
  });
});
