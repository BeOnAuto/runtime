import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { usersOf } from './definition-users.ts';

const at = '2026-10-01T09:00:00.000Z';

function saved(name: string, details?: Schema.JsonObject, status: 'active' | 'retired' = 'active'): StoredDefinition {
  return {
    name,
    version: 1,
    status,
    source: '',
    created_at: at,
    created_by: { id: 'acme-admin', name: 'acme-admin' },
    updated_at: at,
    ...(details === undefined ? {} : { details }),
  };
}

function registryOf(...definitions: readonly StoredDefinition[]): DefinitionRegistry {
  return new Map(definitions.map((definition) => [definition.name, definition]));
}

const reviewBrief = { type: 'reasoning', name: 'review-brief' };

function inStep(number: number, name: string) {
  return { steps: [{ number, name }] };
}

const sendDraft = { type: 'interaction', name: 'send-draft' };

const runsOfReviewBrief = { type: 'run_succeeded', subject: 'reasoning/review-brief' };

const registries = new Map([
  [
    'workflow',
    registryOf(
      saved('weekly-review', {
        calls: [
          { type: 'reasoning', name: 'review-brief', ...inStep(1, 'review') },
          { ...sendDraft, ...inStep(2, 'send') },
          { ...reviewBrief, ...inStep(3, 'again') },
        ],
      }),
      saved('retired-review', { calls: [{ ...reviewBrief, ...inStep(1, 'review') }] }, 'retired'),
      saved('other-names', {
        calls: [
          { type: 'reasoning', name: 'review-briefs', ...inStep(1, 'review') },
          { type: 'interaction', name: 'review-brief', ...inStep(2, 'ask') },
        ],
      }),
      saved('again', { calls: [{ type: 'workflow', name: 'again', ...inStep(1, 'again') }] }),
    ),
  ],
  ['computation', registryOf(saved('campaign-pace'))],
  [
    'recall',
    registryOf(
      saved('review-history', { filters: [runsOfReviewBrief, { ...runsOfReviewBrief, type: 'run_failed' }] }),
      saved('brief-changes', {
        filters: [
          { type: 'definition_updated', source: '/definitions/reasoning/review-brief' },
          { type: 'definition_created', subject: 'reasoning/review-brief' },
          { type: 'run_started', source: '/definitions/reasoning/review-brief' },
        ],
      }),
      saved('every-run', { filters: [{ type: 'run_succeeded' }, { type: 'definition_retired' }] }),
      saved('published-reviews', { filters: [{ type: 'brief.reviewed', subject: 'reasoning/review-brief' }] }),
      saved('runs-and-changes', {
        filters: [{ type: 'definition_retired', source: '/definitions/reasoning/review-brief' }, runsOfReviewBrief],
      }),
    ),
  ],
  ['prediction', registryOf(saved('weekly-orders', { data_sha256: 'a'.repeat(64) }))],
  ['interaction', registryOf(saved('send-draft'), saved('review-brief'))],
  ['reasoning', registryOf(saved('review-brief'))],
  ['probe', registryOf(saved('looks-in', { calls: [{ ...reviewBrief, ...inStep(4, 'look') }] }))],
  ['echo', registryOf(saved('greets', { calls: [{ ...reviewBrief, ...inStep(1, 'greet') }] }))],
]);

describe('the users of a definition', () => {
  it('are the active definitions of every type that name it in its steps or a filter, by type in the order of the function types, workflows next, then by name', () => {
    expect(usersOf(registries, reviewBrief)).toEqual([
      { type: 'recall', name: 'brief-changes', relation: 'remembers-changes' },
      { type: 'recall', name: 'review-history', relation: 'remembers-runs' },
      { type: 'recall', name: 'runs-and-changes', relation: 'remembers-changes' },
      { type: 'recall', name: 'runs-and-changes', relation: 'remembers-runs' },
      {
        type: 'workflow',
        name: 'weekly-review',
        relation: 'calls',
        steps: [
          { number: 1, name: 'review' },
          { number: 3, name: 'again' },
        ],
      },
      { type: 'echo', name: 'greets', relation: 'calls', steps: [{ number: 1, name: 'greet' }] },
      { type: 'probe', name: 'looks-in', relation: 'calls', steps: [{ number: 4, name: 'look' }] },
    ]);
  });

  it('are the workflows that call it in their steps, whatever the type of the definition called', () => {
    expect(usersOf(registries, sendDraft)).toEqual([
      { type: 'workflow', name: 'weekly-review', relation: 'calls', steps: [{ number: 2, name: 'send' }] },
    ]);
  });

  it('are none for a definition nobody names, nor for one that names itself', () => {
    expect([
      usersOf(registries, { type: 'computation', name: 'campaign-pace' }),
      usersOf(registries, { type: 'workflow', name: 'again' }),
      usersOf(new Map(), reviewBrief),
    ]).toEqual([[], [], []]);
  });
});

const steppedRegistries = new Map([
  [
    'workflow',
    registryOf(
      saved('monthly-report', {
        calls: [
          {
            ...reviewBrief,
            steps: [
              { number: 3, name: 'review' },
              { number: 6, name: 'review-again' },
            ],
          },
          { type: 'interaction', name: 'send-draft', steps: [{ number: 4, name: 'send' }] },
          { type: 'computation', name: 'month-window', steps: [{ number: 1, name: 'window' }] },
          { type: 'workflow', name: 'weekly-review', steps: [{ number: 7, name: 'weekly' }] },
        ],
      }),
      saved('weekly-review', { calls: [{ ...reviewBrief, ...inStep(2, 'review') }] }),
    ),
  ],
]);

describe('the users of a definition that a workflow calls by its steps', () => {
  it('are the workflow once, with the steps that call it, each its number and its name', () => {
    expect(usersOf(steppedRegistries, reviewBrief)).toEqual([
      {
        type: 'workflow',
        name: 'monthly-report',
        relation: 'calls',
        steps: [
          { number: 3, name: 'review' },
          { number: 6, name: 'review-again' },
        ],
      },
      { type: 'workflow', name: 'weekly-review', relation: 'calls', steps: [{ number: 2, name: 'review' }] },
    ]);
  });
});
