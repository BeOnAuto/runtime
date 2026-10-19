import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionRegistry } from '../registry/definition-registry.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { overviewTitled } from '../testing/overview-sections.ts';
import { definitionsCalled, usersOf } from './definition-users.ts';

const at = '2026-10-01T09:00:00.000Z';

function saved(name: string, details?: Schema.JsonObject, status: 'active' | 'retired' = 'active'): StoredDefinition {
  return {
    name,
    version: 1,
    status,
    source: '',
    overview: overviewTitled(name),
    created_at: at,
    created_by: 'acme-admin',
    updated_at: at,
    ...(details === undefined ? {} : { details }),
  };
}

function registryOf(...definitions: readonly StoredDefinition[]): DefinitionRegistry {
  return new Map(definitions.map((definition) => [definition.name, definition]));
}

const reviewBrief = { type: 'reasoning', name: 'review-brief' };

const sendBuild = { type: 'interaction', name: 'send-build' };

const approveVersion = { type: 'interaction', name: 'approve-version' };

const runsOfReviewBrief = { type: 'run_succeeded', subject: 'reasoning/review-brief' };

const registries = new Map([
  [
    'workflow',
    registryOf(
      saved('weekly-review', { calls: [{ type: 'reasoning', name: 'review-brief' }, sendBuild, reviewBrief] }),
      saved('retired-review', { calls: [reviewBrief] }, 'retired'),
      saved('other-names', {
        calls: [
          { type: 'reasoning', name: 'review-briefs' },
          { type: 'interaction', name: 'review-brief' },
        ],
      }),
      saved('every-call', { calls: 'every one' }),
      saved('again', { calls: [{ type: 'workflow', name: 'again' }] }),
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
  [
    'prediction',
    registryOf(
      saved('weekly-orders', {
        data_sha256: 'a'.repeat(64),
        calls: [
          { ...sendBuild, role: 'trainer' },
          { ...approveVersion, role: 'approver' },
        ],
      }),
    ),
  ],
  ['interaction', registryOf(saved('send-build'), saved('approve-version'), saved('review-brief'))],
  ['reasoning', registryOf(saved('review-brief'))],
  ['probe', registryOf(saved('looks-in', { calls: [reviewBrief] }))],
  ['echo', registryOf(saved('greets', { calls: [reviewBrief] }))],
]);

describe('the users of a definition', () => {
  it('are the active definitions of every type that name it, by type in the order of the function types, workflows next, then by name', () => {
    expect(usersOf(registries, reviewBrief)).toEqual([
      { type: 'recall', name: 'brief-changes', relation: 'remembers-changes' },
      { type: 'recall', name: 'review-history', relation: 'remembers-runs' },
      { type: 'recall', name: 'runs-and-changes', relation: 'remembers-changes' },
      { type: 'recall', name: 'runs-and-changes', relation: 'remembers-runs' },
      { type: 'workflow', name: 'weekly-review', relation: 'calls' },
      { type: 'echo', name: 'greets', relation: 'calls' },
      { type: 'probe', name: 'looks-in', relation: 'calls' },
    ]);
  });

  it('are the prediction functions that send it builds and that ask it to approve a version, by their roles', () => {
    expect([usersOf(registries, sendBuild), usersOf(registries, approveVersion)]).toEqual([
      [
        { type: 'prediction', name: 'weekly-orders', relation: 'sends-builds' },
        { type: 'workflow', name: 'weekly-review', relation: 'calls' },
      ],
      [{ type: 'prediction', name: 'weekly-orders', relation: 'asks-approval' }],
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
        title: 'Monthly website report',
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
          { ...sendBuild, role: 'trainer' },
          { type: 'reasoning', name: 'unstepped' },
        ],
      }),
      saved('weekly-review', { title: 7, calls: [reviewBrief] }),
    ),
  ],
  ['reasoning', registryOf({ ...saved('review-brief'), description: 'Reviews a brief' }, saved('unstepped'))],
  ['interaction', registryOf(saved('send-draft', undefined, 'retired'))],
]);

describe('the users of a definition that a workflow calls by its steps', () => {
  it('are the workflow once, with the steps that call it, each its number and its name, and the title of the workflow', () => {
    expect(usersOf(steppedRegistries, reviewBrief)).toEqual([
      {
        type: 'workflow',
        name: 'monthly-report',
        title: 'Monthly website report',
        relation: 'calls',
        steps: [
          { number: 3, name: 'review' },
          { number: 6, name: 'review-again' },
        ],
      },
      { type: 'workflow', name: 'weekly-review', relation: 'calls' },
    ]);
  });
});

describe('the definitions a definition calls', () => {
  it('are those its calls name with the steps that call them, in their order, each as the playbook holds it', () => {
    expect(
      definitionsCalled(steppedRegistries, steppedRegistries.get('workflow')?.get('monthly-report')?.details),
    ).toEqual([
      { type: 'reasoning', name: 'review-brief', standing: 'active', description: 'Reviews a brief' },
      { type: 'interaction', name: 'send-draft', standing: 'retired' },
      { type: 'computation', name: 'month-window', standing: 'missing' },
      { type: 'workflow', name: 'weekly-review', standing: 'active' },
    ]);
  });

  it('are none for a definition whose calls say no step, or whose details name none', () => {
    expect([
      definitionsCalled(registries, registries.get('workflow')?.get('weekly-review')?.details),
      definitionsCalled(registries, registries.get('workflow')?.get('every-call')?.details),
      definitionsCalled(registries),
    ]).toEqual([[], [], []]);
  });

  it('carry the title a called workflow records', () => {
    const titled = new Map([['workflow', registryOf(saved('weekly-review', { title: 'The weekly review' }))]]);

    expect(
      definitionsCalled(titled, {
        calls: [{ type: 'workflow', name: 'weekly-review', steps: [{ number: 1, name: 'go' }] }],
      }),
    ).toEqual([{ type: 'workflow', name: 'weekly-review', title: 'The weekly review', standing: 'active' }]);
  });
});
