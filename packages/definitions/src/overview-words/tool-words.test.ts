import { describe, expect, it } from 'vitest';

import { markdownOf, paragraph, theToolOf } from '../index.ts';

describe('the words of a tool', () => {
  it('name the tool and its server, each in bold, after the words the sentence leads with', () => {
    const written = markdownOf({
      title: 'post',
      opening: [],
      body: [paragraph('It sends the request through ', ...theToolOf({ server: 'chat', tool: 'post_message' }), '.')],
      sections: [],
      appendix: [],
    });

    expect(written.split('\n\n').at(-1)).toBe('It sends the request through the tool **post_message** of **chat**.\n');
  });
});
