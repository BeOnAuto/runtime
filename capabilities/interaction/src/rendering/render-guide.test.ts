import { standardComponentDefinitions } from '@json-render/chat';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { problemsOf, renderedDocumentOf } from '../testing/route-documents.ts';
import { renderedCard } from './card-rendering.ts';
import {
  renderCompanionGuides,
  renderGuidePageOf,
  renderGuidePagePathOf,
  renderGuideTextOf,
  schemaWordsOf,
} from './render-guide.ts';
import { renderTargetNames, renderTargetOf } from './render-targets.ts';

const guide = renderGuideTextOf('slack');

const description =
  'How to write a message to Slack as a card: the components and their props, the limits, what is refused and a complete example.';

const example = /```markdown\n([\s\S]*?)\n```/u.exec(guide)?.[1] ?? '';

describe('the guide of a render target', () => {
  it('names each component of the catalog the target takes', () => {
    const named = Object.keys(standardComponentDefinitions).filter((name) => name !== 'Button');

    expect(named.map((name) => guide.includes(`### ${name}\n`))).toEqual(named.map(() => true));
  });

  it('gives the props the catalog defines, as they are written in YAML', () => {
    expect(guide).toContain('- `content`, required: `non-empty text`');
    expect(guide).toContain('- `style`, optional: `plain | bold | muted`');
    expect(guide).toContain('- `rows`, required: `[[text or number]]`');
    expect(guide).toContain('- `headers`, required: `[text] (1 or more)`');
    expect(guide).toContain('- `url`, required: `URL`');
    expect(guide).toContain('segments: [{ label: non-empty text, value: number above 0 }] (1 or more)');
    expect(guide).toContain('xLabel?: text');
    expect(guide).toContain('Takes `children`, a list of element ids.');
    expect(guide).toContain('### Divider\n\nSeparator between groups. No `children`.\n\n- No props');
  });
});

describe('the refusals and limits of the guide of a render target', () => {
  it('refuses the interactive components with what to write instead, and gives no section to them', () => {
    expect(guide).not.toContain('### Button');
    expect(guide).toContain('- `Button`: A click is not taken as an answer, so remove the Button; to send the reader');
    expect(guide).toContain('write only text, image, divider, fields, table, chart and link buttons');
  });

  it('gives every limit of the target and the sizes of the run', () => {
    const limits = renderTargetOf('slack').limits.map(({ words, most }) => `- ${words}: ${most}`);

    expect(limits).toHaveLength(9);
    for (const limit of limits) {
      expect(guide).toContain(`${limit}\n`);
    }
    expect(guide).toContain('- The plain text of the card, `message`: 8 KiB');
    expect(guide).toContain('- The blocks, as JSON: 32 KiB');
  });

  it('is short enough to read in one call', () => {
    expect(Buffer.byteLength(guide)).toBeLessThan(10_000);
  });
});

describe('the example of the guide of a render target', () => {
  it('holds an example function that is saved as written', () => {
    expect(problemsOf(example)).toEqual([]);
  });

  it('holds an example whose card renders to blocks that show what the input holds', () => {
    const { render } = renderedDocumentOf(example);
    const input = {
      channel: '#ops',
      week: '2026-10-05',
      summary: 'Most orders shipped on time.',
      totals: [
        { label: 'Orders', value: '412' },
        { label: 'Late', value: '9' },
      ],
      lateOrders: [['A-1041', 'Northwind', '3']],
      reportUrl: 'https://example.com/report',
    };
    const { text } = Result.getOrThrow(
      renderedCard(render.target, render.card, { input, today: '2026-10-07', now: '2026-10-07T09:00:00Z' }),
    );

    expect(text).toContain('Orders, week of 2026-10-05');
    expect(text).toContain('Northwind');
  });
});

describe('the pages and companions of the render targets', () => {
  it('give one page and one companion guide named for each target', () => {
    expect(renderTargetNames).toEqual(['slack']);
    expect(renderGuidePagePathOf('slack')).toBe('reference/render-slack.md');
    expect(renderCompanionGuides).toEqual([
      {
        type: 'interaction',
        name: 'render-slack',
        title: 'Cards for Slack',
        description,
        page: 'reference/render-slack.md',
      },
    ]);
  });

  it('wrap the guide for the site with its description and no markup in the guide itself', () => {
    const page = renderGuidePageOf('slack');

    expect(page.startsWith(`---\ndescription: '${description}'\n---\n\n<div v-pre>\n\n# Cards for Slack`)).toBe(true);
    expect(page.endsWith(`\n\n</div>\n`)).toBe(true);
    expect(page).toContain(guide.trimEnd());
  });
});

describe('the words of a schema', () => {
  it('say any value for what is no schema, and a kind for one the catalog does not use', () => {
    expect(schemaWordsOf(true)).toBe('any value');
    expect(schemaWordsOf({ type: 'boolean' })).toBe('boolean');
  });

  it('leave out null, join alternatives once, and show an object without properties as empty', () => {
    expect(schemaWordsOf({ type: ['string', 'null'] })).toBe('text');
    expect(schemaWordsOf({ anyOf: [{ type: 'string' }, 'x', { type: 'string' }, { type: 'null' }] })).toBe('text');
    expect(schemaWordsOf({ type: 'object' })).toBe('{}');
    expect(
      schemaWordsOf({ type: 'object', required: ['a'], properties: { a: { type: 'number' }, b: { type: 'boolean' } } }),
    ).toBe('{ a: number, b?: boolean }');
  });
});
