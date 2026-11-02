import { Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { renderClockOf } from '../template/render-clock.ts';
import { documentedJson, documentedLately, documentedMarkdown, documentedPage, pageOf } from '../testing/pages.ts';
import { steppingClock, standingRenderClock } from '../testing/time/stepping-clock.ts';
import { parsePageDocument } from './page-parsing.ts';
import {
  latelyShown,
  resultShown,
  runFailed,
  viewsBeingBuilt,
  viewsStalled,
  type ReadMoment,
} from './page-rendering.ts';

const moment: ReadMoment = { today: '2026-11-01', now: '2026-11-01T09:30:00.000Z', clock: standingRenderClock };

const subject = { type: 'workflow', name: 'morning-social-content', description: 'Drafts the posts', version: 2 };

const documented = Result.getOrThrow(parsePageDocument(documentedPage));

const declared = documented.data?.views ?? {};

function templateOf(body: string) {
  const parsed = Result.getOrThrow(parsePageDocument(pageOf({ body: `{% result %}${body}{% endresult %}` })));
  return Result.getOrThrow(Result.fromNullishOr(parsed.templates.result, () => 'no result'));
}

const documentedResult = Result.getOrThrow(Result.fromNullishOr(documented.templates.result, () => 'no result'));

const [documentedOutput = null, documentedViews = null] = documentedJson;

const documentedLatelyTemplate = Result.getOrThrow(
  Result.fromNullishOr(documented.templates.lately, () => 'no lately'),
);

const succeeded = {
  status: 'succeeded',
  output: documentedOutput,
  started: '2026-11-01T07:00:00.000Z',
  ended: '2026-11-01T07:02:00.000Z',
  version: 1,
} as const;

function shownOver(body: string, output: Schema.Json = {}, on: ReadMoment = moment): string {
  return resultShown(templateOf(body), { ...succeeded, output }, subject, on);
}

describe('the result of a run, as the documented page shows it', () => {
  it('lists the posts of the run, its first line the headline', () => {
    expect(resultShown(documentedResult, succeeded, subject, moment)).toBe(documentedMarkdown[0]?.trim());
  });

  it('says the run waits while it is still going', () => {
    expect(
      resultShown(documentedResult, { ...succeeded, status: 'started', output: null, ended: null }, subject, moment),
    ).toBe('Waiting for approval of the posts drafted this morning.');
  });
});

describe('a run that was rejected or failed', () => {
  it('is shown as a fixed sentence with its reason, its kind and its detail where it has them', () => {
    expect([
      resultShown(
        documentedResult,
        { status: 'rejected', rejection: { reason: 'unanswered', kind: 'expired' } },
        subject,
        moment,
      ),
      resultShown(documentedResult, { status: 'rejected', rejection: { reason: 'cancelled' } }, subject, moment),
      resultShown(
        documentedResult,
        {
          status: 'rejected',
          rejection: { reason: 'conflict', kind: 'unworkable', detail: 'The program raised an error on line 3.' },
        },
        subject,
        moment,
      ),
      resultShown(documentedResult, { status: 'failed' }, subject, moment),
    ]).toEqual([
      'The run was rejected as unanswered, expired.',
      'The run was rejected as cancelled.',
      'The run was rejected as conflict, unworkable. The program raised an error on line 3.',
      runFailed,
    ]);
  });
});

describe('the variables of result', () => {
  it('are the output, the run, the subject and the moment of the read, with white space at each end dropped', () => {
    const body =
      '\n  {{ run.status }} {{ run.version }} of {{ subject.type }}/{{ subject.name }} v{{ subject.version }}, {{ subject.description }}, {{ today }} {{ now }} {{ output.count }} {{ run.started }}-{{ run.ended }}  \n';

    expect(shownOver(body, { count: 3 })).toBe(
      'succeeded 1 of workflow/morning-social-content v2, Drafts the posts, 2026-11-01 2026-11-01T09:30:00.000Z 3 2026-11-01T07:00:00.000Z-2026-11-01T07:02:00.000Z',
    );
  });

  it('read only a value’s own fields, a list as its items and an object as Liquid writes it', () => {
    expect([
      shownOver('{{ output.constructor }}'),
      shownOver('{{ output.tags }}{{ output.post }}', { tags: ['a', 'b'], post: {} }),
    ]).toEqual([
      'Could not display this run: the value has no field output.constructor, on line 4.',
      'ab[object Object]',
    ]);
  });

  it('read a missing field in a condition or through default without stopping the render', () => {
    expect(
      shownOver('{% if output.title %}{{ output.title }}{% endif %}{{ output.title | default: "Untitled" }}'),
    ).toBe('Untitled');
  });
});

describe('a render that stops', () => {
  it('shows the one line that says why, with its line', () => {
    expect(shownOver('\n{{ output.date }}')).toBe(
      'Could not display this run: the value has no field output.date, on line 5.',
    );
    expect(shownOver('{{ "dollars" | money }}')).toMatch(/^Could not display this run: .+, on line 4\.$/u);
  });

  it('names the bound a render went past', () => {
    const stepping: ReadMoment = { ...moment, clock: renderClockOf(steppingClock(1000)) };

    expect([
      shownOver('{% for each in (1..70000) %}ab{% endfor %}'),
      shownOver('{% for each in (1..6000000) %}{% endfor %}'),
      shownOver('{% for each in (1..3) %}{{ each }}{% endfor %}', {}, stepping),
    ]).toEqual([
      'Could not display this run: the rendered block exceeds 65536 bytes, on line 4.',
      'Could not display this run: rendering exceeded 5000000 characters or items, on line 4.',
      'Could not display this run: rendering exceeded 200 ms, on line 4.',
    ]);
  });
});

describe('lately, as the documented page shows it', () => {
  it('renders the views with their charts', () => {
    expect(
      latelyShown(documentedLatelyTemplate, { state: 'live', views: documentedViews }, { declared, subject }, moment),
    ).toBe(documentedLately.trim());
  });

  it('reads a view the fold has not given yet as null, so its chart says it has no data', () => {
    expect(latelyShown(documentedLatelyTemplate, { state: 'live', views: {} }, { declared, subject }, moment)).toBe(
      ['No data for this chart yet.', '', 'No data for this chart yet.'].join('\n'),
    );
  });

  it('is the one line that says the views are being built, or stopped', () => {
    expect([
      latelyShown(documentedLatelyTemplate, { state: 'building' }, { declared, subject }, moment),
      latelyShown(documentedLatelyTemplate, { state: 'stalled' }, { declared, subject }, moment),
    ]).toEqual([viewsBeingBuilt, viewsStalled]);
  });

  it('shows the line that says why its render stopped', () => {
    const stepping: ReadMoment = { ...moment, clock: renderClockOf(steppingClock(1000)) };

    expect(latelyShown(documentedLatelyTemplate, { state: 'live', views: {} }, { declared, subject }, stepping)).toBe(
      'Could not display this page’s figures: rendering exceeded 200 ms, on line 54.',
    );
  });
});
