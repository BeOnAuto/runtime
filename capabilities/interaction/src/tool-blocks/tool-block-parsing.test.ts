import { describe, expect, it } from 'vitest';

import {
  answering,
  delivering,
  documentOf,
  problemsOf,
  reading,
  replacing,
  requestDocumentOf,
  without,
} from '../testing/route-documents.ts';

const serverShape = 'Expected a server name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter';

const toolShape = 'Expected a tool name of 1 to 128 letters, digits, underscores, hyphens and dots';

describe('a definition that delivers through a tool and reads its replies', () => {
  it('reads deliver and replies as written', () => {
    const parsed = requestDocumentOf(documentOf(delivering, reading, answering));

    expect(parsed.route).toMatchObject({
      deliver: {
        server: 'chat',
        tool: 'post_message',
        with: { channel: '{{ to }}', text: '{{ message }}' },
        sent: { conversation: '/channel', id: '/ts' },
      },
      replies: {
        tool: 'thread_replies',
        read: { list: '/messages', order: 'oldest_first', each: { id: '/ts', sender: '/user', to: '/thread_ts' } },
        wait: 'PT1M',
        tell: { with: { thread_ts: '{{ sent.id }}' } },
      },
    });
  });

  it('takes a delivery alone, and a reading without its key, its wait or its telling', () => {
    const plain = without(reading, '  wait: PT1M', '  tell:', '    with:', "      thread_ts: '{{ sent.id }}'");
    const bare = without(
      plain,
      "  conversation: '{{ sent.conversation }}/{{ sent.id }}'",
      "      channel: '{{ sent.conversation }}'",
      "      text: '{{ message }}'",
    );

    expect([problemsOf(documentOf(delivering)), problemsOf(documentOf(delivering, bare, answering))]).toEqual([[], []]);
  });
});

describe('the keys of a delivery and its reading', () => {
  it('refuse a key neither takes, at every level, as any unknown key', () => {
    expect([
      problemsOf(documentOf(delivering, ['replies:', '  server: other'], reading.slice(1), answering)),
      problemsOf(documentOf(replacing(delivering, '    id: /ts', '    id: /ts\n    at: /when'))),
    ]).toEqual([
      ['Line 14, /replies/server: server is not a key of replies; it takes conversation, tool, with, read, wait, tell'],
      ['Line 13, /deliver/sent/at: at is not a key of deliver.sent; it takes conversation, id'],
    ]);
  });

  it('refuse a reading without a delivery, without an answer to read, or without the message that was sent', () => {
    const unsent = without(delivering, '  sent:', '    conversation: /channel', '    id: /ts');

    expect([
      problemsOf(documentOf(delivering.slice(0, 2), reading, answering)),
      problemsOf(documentOf(delivering, reading)),
      problemsOf(documentOf(unsent, reading, answering)),
    ]).toEqual([
      [
        'Line 5, /replies: Only a function that delivers through a tool reads replies; a function without deliver waits in the inbox',
      ],
      ['Line 14, /replies: A notification takes no answer, so it reads no replies'],
      [
        'Line 11, /replies: Reading replies needs deliver.sent, the pointers to the conversation and the identity of the message the tool sent',
      ],
    ]);
  });
});

describe('a reading refused for its form and for its parts at once', () => {
  it('names every problem, each at its line', () => {
    const named = replacing(delivering, '  server: chat', '  server: Chat!');

    expect(problemsOf(documentOf(named, reading))).toEqual([
      `Line 5, /deliver/server: ${serverShape}`,
      'Line 14, /replies: A notification takes no answer, so it reads no replies',
    ]);
  });
});

describe('the names a delivery and its reading give', () => {
  it('refuse a server or a tool whose name has not the shape of one', () => {
    const named = replacing(
      replacing(delivering, '  server: chat', '  server: Chat!'),
      '  tool: post_message',
      '  tool: post message',
    );
    const readBy = replacing(reading, '  tool: thread_replies', '  tool: thread/replies');
    const toldBy = replacing(readBy, '  tell:', '  tell:\n    tool: tell?');

    expect([problemsOf(documentOf(named)), problemsOf(documentOf(delivering, toldBy, answering))]).toEqual([
      [`Line 5, /deliver/server: ${serverShape}`, `Line 6, /deliver/tool: ${toolShape}`],
      [`Line 15, /replies/tool: ${toolShape}`, `Line 27, /replies/tell/tool: ${toolShape}`],
    ]);
  });

  it('refuse an order of reading that is neither', () => {
    const ordered = replacing(reading, '    order: oldest_first', '    order: oldest');

    expect(problemsOf(documentOf(delivering, ordered, answering))).toEqual([
      expect.stringMatching(/^Line 23, \/replies\/read\/order: /u),
    ]);
  });
});

describe('the pointers into what a tool answered', () => {
  it('refuse at each place, in one sentence, a pointer that is empty or is not a JSON Pointer', () => {
    const pointer =
      'Expected a JSON Pointer such as /messages: it starts with a slash, writes ~ as ~0 and a slash within a name as ~1';
    const sent = replacing(
      replacing(delivering, '    conversation: /channel', "    conversation: ''"),
      '    id: /ts',
      '    id: ts',
    );
    const read = replacing(
      replacing(reading, '    list: /messages', '    list: messages'),
      '    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }',
      "    each: { id: '', sender: user, text: /a~2, to: '' }",
    );

    expect(problemsOf(documentOf(sent, read, answering))).toEqual([
      `Line 11, /deliver/sent/conversation: ${pointer}`,
      `Line 12, /deliver/sent/id: ${pointer}`,
      `Line 22, /replies/read/list: ${pointer}`,
      `Line 24, /replies/read/each/id: ${pointer}`,
      `Line 24, /replies/read/each/sender: ${pointer}`,
      `Line 24, /replies/read/each/text: ${pointer}`,
      `Line 24, /replies/read/each/to: ${pointer}`,
    ]);
  });
});

const textOf = (bytes: number) => `'${'a'.repeat(bytes)}'`;

describe('the arguments of a read, rendered once when saved', () => {
  it('refuse one that renders no JSON, one past what a call may send, and arguments past it, over a sample reading', () => {
    const unrendered = replacing(reading, "    ts: '{{ sent.id }}'", "    ts: '{{ 1 | divided_by: 0 }}'");
    const long = replacing(reading, "    ts: '{{ sent.id }}'", `    ts: ${textOf(16_400)}`);
    const large = replacing(
      replacing(reading, "    ts: '{{ sent.id }}'", `    ts: ${textOf(9000)}`),
      '    limit: 15',
      `    limit: ${textOf(9000)}`,
    );

    expect([
      problemsOf(documentOf(delivering, unrendered, answering)),
      problemsOf(documentOf(delivering, long, answering)),
      problemsOf(documentOf(delivering, large, answering)),
    ]).toEqual([
      ['Line 18, /replies/with/ts: The argument ts of the read over a sample reading cannot be rendered'],
      [
        'Line 18, /replies/with/ts: The argument ts of the read over a sample reading renders more than the 16384 bytes a call may send',
      ],
      [
        expect.stringMatching(
          /^Line 17, \/replies\/with: The arguments of the read over a sample reading take \d+ bytes, more than the 16384 a call may send$/u,
        ),
      ],
    ]);
  });
});

describe('the wait of a reading', () => {
  it.each(['PT5S', 'PT1H'])('takes %s, at its bound', (wait) => {
    expect(
      problemsOf(documentOf(delivering, replacing(reading, '  wait: PT1M', `  wait: ${wait}`), answering)),
    ).toEqual([]);
  });

  it.each(['PT4S', 'PT61M', 'soon'])('refuses %s, outside its bounds or not a duration', (wait) => {
    expect(
      problemsOf(documentOf(delivering, replacing(reading, '  wait: PT1M', `  wait: ${wait}`), answering)),
    ).toEqual(['Line 25, /replies/wait: Expected an ISO 8601 duration from PT5S to PT1H, such as PT1M']);
  });
});
