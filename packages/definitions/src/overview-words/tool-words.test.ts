import { describe, expect, it } from 'vitest';

import { markdownOf, paragraph, theToolOf } from '../index.ts';
import { theToolAsWritten } from './tool-words.ts';

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

  it('name the tool as written, in code, and its server, as Details names them', () => {
    expect(theToolAsWritten({ server: 'chat', tool: 'post_message' })).toEqual([
      'the tool ',
      { code: 'post_message' },
      ' of the server ',
      { server: 'chat' },
    ]);
  });
});
