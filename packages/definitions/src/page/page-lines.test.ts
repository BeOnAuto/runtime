import { describe, expect, it } from 'vitest';

import { withoutThePage } from './page-lines.ts';

describe('a document without its page', () => {
  it('keeps every line, the lines of its page key blank, whether the page ends the document or not', () => {
    expect(withoutThePage('name: morning\npage:\n  result: |\n    Hi\ndo: []\n', 'workflow')).toBe(
      'name: morning\n\n\n\ndo: []\n',
    );
    expect(withoutThePage('---\nmodel: x\npage:\n  result: Hi\n---\nSay hi.\n', 'function')).toBe(
      '---\nmodel: x\n\n\n---\nSay hi.\n',
    );
  });

  it('is the document as it is without a page key, or without front matter for a function', () => {
    expect(withoutThePage('name: morning\ndo: []\n', 'workflow')).toBe('name: morning\ndo: []\n');
    expect(withoutThePage('page: x\n', 'function')).toBe('page: x\n');
    expect(withoutThePage('---\npage: x\n', 'function')).toBe('---\npage: x\n');
  });
});
