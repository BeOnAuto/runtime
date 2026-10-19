import { describe, expect, it } from 'vitest';

import {
  composedOverview,
  markdownOf,
  mostOverviewBytes,
  overviewAtRead,
  paragraph,
  sectionOf,
  type DefinitionUser,
  type Overview,
} from '../index.ts';
import { encodedOverview } from '../overview/overview.ts';
import { overviewAsRead, overviewTitled } from '../testing/index.ts';
import { overviewReadFrom } from './overview-at-read.ts';

const sendBuild: Overview = composedOverview({
  name: 'send-build',
  noun: { one: 'item', other: 'items' },
  summary: {},
});

const nothingKnown = { users: [], called: [] };

describe('the overview a read writes', () => {
  it('is the stored one as written when nothing uses the definition and it calls nothing', () => {
    expect(overviewAtRead(sendBuild, nothingKnown)).toBe(markdownOf(sendBuild));
  });

  it('lists the exact name and the type of each user once under Details, after the facts the stored overview keeps there', () => {
    const users: readonly DefinitionUser[] = [
      { type: 'interaction', name: 'approve-version', relation: 'calls' },
      { type: 'recall', name: 'review-history', relation: 'remembers-runs' },
      { type: 'recall', name: 'review-history', relation: 'remembers-changes' },
    ];
    const stored = { ...sendBuild, appendix: [sectionOf('Input', paragraph('A record.'))] };

    expect(overviewAtRead(stored, { users, called: [] }).split('\n\n## Details\n\n')[1]).toBe(
      [
        '### Input',
        'A record.',
        '### Used by',
        '- `approve-version`, an interaction function\n- `review-history`, a recall function\n',
      ].join('\n\n'),
    );
  });

  it('writes what it calls before who uses it, after the sections of the body, and their exact names in the same order under Details', () => {
    const written = overviewAtRead(sendBuild, {
      users: [{ type: 'workflow', name: 'weekly-review', relation: 'calls' }],
      called: [{ type: 'reasoning', name: 'review-brief', standing: 'missing' }],
    });

    expect(written.split('\n\n').filter((block) => block.startsWith('#'))).toEqual([
      '# send-build',
      '## What it needs',
      '## What it produces',
      '## What it calls',
      '## Used by',
      '## Details',
      '### What it calls',
      '### Used by',
    ]);
    expect(
      written.endsWith(
        '### What it calls\n\n- `review-brief`, a reasoning function\n\n### Used by\n\n- `weekly-review`, a workflow\n',
      ),
    ).toBe(true);
  });
});

describe('the phrases of a stored overview, written at read', () => {
  it('write a server by its name and a definition by its title, or its name in words, and in Details by its name', () => {
    const stored: Overview = {
      ...sendBuild,
      body: [
        paragraph(
          'It sends the build through ',
          { server: 'gas' },
          ' to ',
          { definition: { type: 'workflow', name: 'train-it' } },
          '.',
        ),
      ],
      appendix: [
        sectionOf(
          'Calls',
          paragraph({ definition: { type: 'workflow', name: 'train-it', title: 'Train it now' } }, '.'),
        ),
      ],
    };

    expect(overviewAtRead(stored, nothingKnown).split('\n\n')).toContain(
      'It sends the build through **gas** to **Train it**.',
    );
    expect(overviewAtRead(stored, nothingKnown).endsWith('### Calls\n\n`train-it`.\n')).toBe(true);
  });
});

describe('the overview a read writes near the bound of an overview', () => {
  it('keeps who uses the definition in its body and loses their exact names first, with the line that says it stops', () => {
    const users: readonly DefinitionUser[] = Array.from({ length: 80 }, (_, index) => ({
      type: 'recall',
      name: `review-history-${index}`,
      relation: 'remembers-runs',
    }));
    const stored: Overview = { ...sendBuild, body: Array.from({ length: 15 }, () => paragraph('é'.repeat(2000))) };
    const written = overviewAtRead(stored, { users, called: [] });

    expect(new TextEncoder().encode(written).byteLength).toBeLessThanOrEqual(mostOverviewBytes);
    expect(written.split('\n').filter((line) => line.startsWith('- The recall function '))).toHaveLength(80);
    expect(written).not.toContain('## Details');
    expect(written.endsWith('the whole definition is under Source.*\n')).toBe(true);
  });
});

describe('the overview a read writes from what the playbook holds', () => {
  it('names the definitions a workflow calls as the playbook holds them, and those that use it by their titles and steps', () => {
    const written = overviewAsRead(
      {
        type: 'workflow',
        name: 'weekly-review',
        overview: overviewTitled('weekly-review', 'Reviews the week'),
        details: {
          calls: [
            { type: 'reasoning', name: 'review-brief', steps: [{ number: 2, name: 'review' }] },
            { type: 'interaction', name: 'approve', steps: [{ number: 3, name: 'approve' }] },
          ],
        },
      },
      [
        { type: 'reasoning', name: 'review-brief', description: 'Reviews a brief' },
        { type: 'interaction', name: 'approve', status: 'retired' },
        {
          type: 'workflow',
          name: 'monthly',
          details: {
            title: 'The monthly review',
            calls: [{ type: 'workflow', name: 'weekly-review', steps: [{ number: 1, name: 'weekly' }] }],
          },
        },
      ],
    );

    expect(written).toBe(
      [
        '# weekly-review',
        'Reviews the week',
        '## What it calls',
        'It calls the reasoning function **Review brief**: Reviews a brief.',
        'It calls the interaction function **Approve**, which is retired.',
        '## Used by',
        '- The workflow **The monthly review** calls it in step 1, **Weekly**.',
        '## Details',
        '### What it calls',
        '- `review-brief`, a reasoning function\n- `approve`, an interaction function',
        '### Used by',
        '- `monthly`, a workflow\n',
      ].join('\n\n'),
    );
  });
});

describe('the overview a read decodes', () => {
  it('is the encoded form the fact keeps, and a kept value that is not an overview throws, so its read fails with a server error, as the read of an event that does not decode does', () => {
    const kept = encodedOverview(overviewTitled('plain', 'Plain'));

    expect(overviewReadFrom(new Map(), 'probe', { name: 'plain', overview: kept })).toBe('# plain\n\nPlain\n');
    expect(() => overviewReadFrom(new Map(), 'probe', { name: 'plain', overview: '# plain\n' })).toThrow(
      'Expected object',
    );
  });
});
