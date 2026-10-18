import { describe, expect, it } from 'vitest';

import { markdownOf, mostOverviewBytes, paragraph, sectionOf } from '../index.ts';
import type { Overview, OverviewSection } from '../index.ts';

const utf8 = new TextEncoder();

const cutLine =
  '*The overview stops here, at the 65,536 bytes an overview may take; the whole definition is under Source.*';

function paragraphOf(bytes: number) {
  return paragraph('é'.repeat(bytes / 2));
}

describe('the parts of an overview', () => {
  it('are its body after the opening, then its sections, then its appendix under Details, each section of the appendix at ###', () => {
    expect(
      markdownOf({
        title: 'month-window',
        opening: ['The first and last day of a month'],
        body: [paragraph('It takes a month.'), paragraph('It answers its first and last day.')],
        sections: [sectionOf('What it needs', paragraph('A month.'))],
        appendix: [sectionOf('Input', paragraph('A record.')), sectionOf('Output', paragraph('Two dates.'))],
      }),
    ).toBe(
      [
        '# month-window',
        'The first and last day of a month',
        'It takes a month.',
        'It answers its first and last day.',
        '## What it needs',
        'A month.',
        '## Details',
        '### Input',
        'A record.',
        '### Output',
        'Two dates.\n',
      ].join('\n\n'),
    );
  });

  it('write no Details for an appendix that holds no block, and no heading of a section of it that holds none', () => {
    const appendix = [sectionOf('Input'), sectionOf('Output', paragraph('A date.')), sectionOf('Calls')];

    expect([
      markdownOf({ title: 'plain', opening: ['Plain'], body: [], sections: [], appendix: [sectionOf('Input')] }),
      markdownOf({ title: 'plain', opening: ['Plain'], body: [], sections: [], appendix }),
    ]).toEqual(['# plain\n\nPlain\n', '# plain\n\nPlain\n\n## Details\n\n### Output\n\nA date.\n']);
  });
});

describe(`an overview whose appendix passes ${mostOverviewBytes} bytes`, () => {
  const body = Array.from({ length: 15 }, () => paragraphOf(4000));

  function withAppendix(...appendix: readonly OverviewSection[]): Overview {
    return { title: 'review-brief', opening: ['Reviews a campaign brief'], body, sections: [], appendix };
  }

  it('keeps its body whole and cuts its appendix with the line that says so, Details and all when no block of it fits', () => {
    const written = markdownOf(withAppendix(sectionOf('Input', paragraphOf(6000))));
    const blocks = written.trimEnd().split('\n\n');

    expect(utf8.encode(written).byteLength).toBeLessThanOrEqual(mostOverviewBytes);
    expect(blocks).toHaveLength(2 + 15 + 1);
    expect(blocks.at(-1)).toBe(cutLine);
    expect(written).not.toContain('## Details');
  });

  it('writes Details and the parts of it that fit, a heading only with a block of its own, and cuts the rest', () => {
    const written = markdownOf(
      withAppendix(sectionOf('Input', paragraph('A record.')), sectionOf('Output', paragraphOf(6000))),
    );

    expect(written.endsWith(`## Details\n\n### Input\n\nA record.\n\n${cutLine}\n`)).toBe(true);
    expect(utf8.encode(written).byteLength).toBeLessThanOrEqual(mostOverviewBytes);
  });

  it('cuts its body before its appendix, writing no Details, when the body alone passes the bound', () => {
    const written = markdownOf({
      ...withAppendix(sectionOf('Input', paragraph('A record.'))),
      body: Array.from({ length: 20 }, () => paragraphOf(4000)),
    });

    expect(written.endsWith(`${'é'.repeat(2000)}\n\n${cutLine}\n`)).toBe(true);
    expect(written).not.toContain('## Details');
  });
});
