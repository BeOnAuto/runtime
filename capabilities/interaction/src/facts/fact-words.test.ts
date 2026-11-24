import { describe, expect, it } from 'vitest';

import { replyRefused } from './fact-words.ts';

const ofTheReply = { server: 'chat', tool: 'chat_postMessage', reply: { id: 'click:1', sender: 'ada' } };

describe('the words of a reply the run refused', () => {
  it('say of a click on a button the request did not send that it was not taken, and that nobody was told', () => {
    const words = replyRefused({
      type: 'reply_refused',
      data: { ...ofTheReply, because: 'unknown_button', told: false, delivered: true },
    });

    expect(words).toBe('A click on a button the request did not send was not taken, and nobody was told.');
  });
});
