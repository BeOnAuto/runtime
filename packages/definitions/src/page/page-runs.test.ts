import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionOperations } from '../operations/definition-operations.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { checkingNothing, keepingNoViews } from '../testing/page-ports.ts';
import { shapeNamed } from '../testing/shapes.ts';
import { makePageAdapter } from './page-adapter.ts';
import { runShownOf } from './page-reads.ts';
import { sampleRunOf } from './sample-runs.ts';

const ran = {
  run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  type: 'workflow',
  name: 'morning-social-content',
  definition_version: 2,
  started_at: '2026-11-01T07:00:00.000Z',
  started_by: { id: 'acme-admin', name: 'acme-admin' },
} as const;

const subject: StoredDefinition = {
  name: 'morning-social-content',
  version: 3,
  status: 'active',
  source: '{}',
  created_at: '2026-10-01T09:00:00.000Z',
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: '2026-10-01T09:00:00.000Z',
};

describe('a run as a page reads it', () => {
  it('is going with no output yet, or succeeded with its output, its times and its version', () => {
    expect([
      runShownOf({ ...ran, status: 'started' }),
      runShownOf({ ...ran, status: 'succeeded', output: { posts: [] }, finished_at: '2026-11-01T07:02:00.000Z' }),
    ]).toEqual([
      { status: 'started', output: null, started: ran.started_at, ended: null, version: 2 },
      {
        status: 'succeeded',
        output: { posts: [] },
        started: ran.started_at,
        ended: '2026-11-01T07:02:00.000Z',
        version: 2,
      },
    ]);
  });

  it('is rejected with its reason, its kind where it has one and its detail, or failed', () => {
    expect([
      runShownOf({
        ...ran,
        status: 'rejected',
        rejection: { reason: 'unanswered', kind: 'expired', detail: 'Nobody answered' },
      }),
      runShownOf({ ...ran, status: 'rejected', rejection: { reason: 'conflict', detail: 'It clashed' } }),
      runShownOf({ ...ran, status: 'failed' }),
    ]).toEqual([
      { status: 'rejected', rejection: { reason: 'unanswered', kind: 'expired', detail: 'Nobody answered' } },
      { status: 'rejected', rejection: { reason: 'conflict', detail: 'It clashed' } },
      { status: 'failed' },
    ]);
  });
});

describe('a sample output', () => {
  it('is taken as it is for a subject with no output schema, as a run of its latest version', async () => {
    expect(await Effect.runPromise(sampleRunOf(subject, { anything: true }))).toMatchObject({
      status: 'succeeded',
      output: { anything: true },
      version: 3,
    });
  });

  it('is checked with the rules of the shape its subject answers', async () => {
    const backwards = {
      lines: [
        {
          name: 'Posts',
          points: [
            { at: '2026-11-01T09:00:00Z', value: 1 },
            { at: '2026-10-01T09:00:00Z', value: 2 },
          ],
        },
      ],
    };
    const shaped = { ...subject, output_schema: shapeNamed('series').schema };

    expect(await Effect.runPromise(Effect.flip(sampleRunOf(shaped, backwards)))).toMatchObject({
      issues: [
        { pointer: '/sample_output/lines/0/points/1/at', detail: 'Expected a time later than the point before it' },
      ],
    });
  });
});

function namesOf(capabilities: Parameters<typeof makeDefinitionOperations>[0]): readonly string[] {
  return makeDefinitionOperations(capabilities).map(({ registration }) => registration.name);
}

describe('the route that renders a page', () => {
  it('is served beside the definitions where pages are, and not where they are not', () => {
    expect(namesOf([echo, makePageAdapter({ pool: checkingNothing, views: keepingNoViews })])).toContain('render_page');
    expect(namesOf([echo])).not.toContain('render_page');
  });
});
