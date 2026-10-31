import { describe, expect, it } from 'vitest';

import type { ServerTool, ToolServer } from '../listing/tool-server.ts';
import { requestCarriersAmong } from './request-carriers.ts';

interface Written {
  readonly reads?: boolean;
  readonly deletes?: boolean;
  readonly answersNoBody?: boolean;
  readonly takes?: readonly string[];
}

function tool(name: string, description: string, written: Written = {}): ServerTool {
  const { reads = false, deletes = false, answersNoBody = false, takes = [] } = written;
  return {
    name,
    description,
    input_schema: { type: 'object', properties: Object.fromEntries(takes.map((taken) => [taken, { type: 'string' }])) },
    ...(reads ? { annotations: { readOnlyHint: true } } : {}),
    ...(deletes ? { annotations: { destructiveHint: true } } : {}),
    ...(answersNoBody ? { answersNoBody: true } : {}),
  };
}

function served(name: string, tools: readonly ServerTool[], connection?: string): ToolServer {
  return {
    name,
    type: 'mcp',
    record_content: true,
    playbooks: ['*'],
    ...(connection === undefined ? {} : { connection }),
    provider: connection === undefined ? null : name,
    tools,
  };
}

const chat = served('chat', [
  tool('post_message', 'Posts a message to a channel.', { takes: ['channel', 'text'] }),
  tool('chat_update', 'Updates a message.', { takes: ['channel', 'ts', 'text'] }),
  tool('thread_replies', 'Lists the replies of a thread.', { reads: true, takes: ['channel', 'ts'] }),
  tool('list_channels', 'Lists the channels.', { reads: true }),
]);

const mail = served(
  'mail',
  [
    tool('me.messages.message.reply', 'Reply to the sender of a message, with a comment.', {
      takes: ['message', 'comment', 'message-id'],
    }),
    tool('me.sendMail', 'Send the message given as mail.', { takes: ['message'] }),
    tool('me.ListMessages', 'List the messages of the mailbox.', { reads: true, takes: ['search'] }),
  ],
  'conn_mail',
);

const tracker = served(
  'tracker',
  [
    tool('create_issue', 'Create an issue.', { takes: ['title'] }),
    tool('create_comment', 'Create a comment on an issue.', { takes: ['issue', 'body'] }),
    tool('list_comments', 'List the comments of an issue.', { reads: true, takes: ['issue'] }),
  ],
  'conn_tracker',
);

const readingReplies = tool('thread_replies', 'Lists the replies of a thread.', { reads: true });

function sendingOf(name: string): string | undefined {
  const [carrier] = requestCarriersAmong([served('any', [tool(name, 'Does it.'), readingReplies])]);
  return carrier?.sending;
}

describe('the servers that can carry a request for a person', () => {
  it('are those that offer a tool that sends and a read-only tool that reads replies, each the best by the search scoring', () => {
    expect(requestCarriersAmong([chat, mail, tracker])).toEqual([
      { server: 'chat', provider: null, sending: 'post_message', reading: 'thread_replies' },
      { server: 'mail', connection: 'conn_mail', provider: 'mail', sending: 'me.sendMail', reading: 'me.ListMessages' },
      {
        server: 'tracker',
        connection: 'conn_tracker',
        provider: 'tracker',
        sending: 'create_comment',
        reading: 'list_comments',
      },
    ]);
  });

  it('weigh a sending tool by what it does, so a tool that takes a message to reply to is not the one that sends', () => {
    const replying = served('replying', [
      tool('reply_to_message', 'Replies to a message.', { takes: ['message', 'message_id', 'comment'] }),
      tool('send_mail', 'Sends mail.', { takes: ['to'] }),
      tool('message_replies', 'Lists the replies to a message.', { reads: true }),
    ]);

    expect(requestCarriersAmong([replying])).toEqual([
      { server: 'replying', provider: null, sending: 'send_mail', reading: 'message_replies' },
    ]);
  });
});

describe('the tool that sends a request for a person', () => {
  it('is taken by a sending verb in its name, in any of its forms or with an article joined to it, or by create or write with a message, comment or mail', () => {
    const named = [
      'send',
      'sends_mail',
      'postMessage',
      'published_note',
      'replies.create',
      'comment_on_issue',
      'mailing.start',
      'sendaChatMessage',
      'chats.CreateMessages',
      'write_message',
      'creating_email',
    ];

    expect(named.map((name) => sendingOf(name))).toEqual(named);
  });

  it('is the first by name of those that score alike, one that scores nothing among them', () => {
    const alike = served('alike', [tool('publish_b', 'Does it.'), tool('publish_a', 'Does it.'), readingReplies]);

    expect(requestCarriersAmong([alike])).toMatchObject([{ sending: 'publish_a' }]);
  });
});

describe('the tool that sends, beside the other operations a name may carry', () => {
  it('is never one whose name carries another operation, whatever sending word it carries too', () => {
    const named = [
      'update_post',
      'pin_post',
      'delete_comment',
      'update_mail_settings',
      'list_messages_to_send',
      'get_sent_mail',
    ];

    expect(named.filter((name) => sendingOf(name) !== undefined)).toEqual([]);
  });

  it('is still taken where the name carries no other operation, as the senders of the shipped providers do', () => {
    const named = [
      'chat_postMessage',
      'chats.CreateMessages',
      'sendaChatMessage',
      'me.sendMail',
      'create_comment',
      'createPosts',
    ];

    expect(named.map((name) => sendingOf(name))).toEqual(named);
  });
});

describe('the tool that sends, beside what it says and answers', () => {
  it('is never taken by its description alone, nor one whose name has a message, comment or mail but no verb that sends', () => {
    const named = ['trash_message', 'record_changes', 'mailbox_settings', 'create_issue', 'postpone_meeting', 'notify'];
    const describedAsSending = served('cleanup', [
      ...named.map((name) => tool(name, 'Sends a message, posts a comment and mails it to the person.')),
      readingReplies,
    ]);

    expect(requestCarriersAmong([describedAsSending])).toEqual([]);
  });

  it('is never one that deletes, or one whose described answer has no body, since deliver.sent points into what it answers', () => {
    const posts = served('posts', [
      tool('create_post', 'Creates a post; its answer has no body.', { answersNoBody: true }),
      tool('delete_post', 'Deletes a post.', { deletes: true }),
      readingReplies,
    ]);

    expect(requestCarriersAmong([posts])).toEqual([]);
  });
});

describe('a server that can carry a notification alone', () => {
  it('is named without a reading tool where it sends but reads no replies', () => {
    const unmarked = served('unmarked', [
      tool('send_message', 'Sends a message.'),
      tool('read_thread', 'Reads the replies of a thread.'),
    ]);

    expect(requestCarriersAmong([unmarked])).toEqual([{ server: 'unmarked', provider: null, sending: 'send_message' }]);
  });

  it('is not one that only reads, nor one that cannot be asked', () => {
    const readingAlone = served('mail-reader', [tool('list_messages', 'Lists messages.', { reads: true })]);
    const unreachable: ToolServer = {
      name: 'gone',
      type: 'mcp',
      record_content: true,
      playbooks: ['*'],
      provider: null,
      unavailable: 'It could not be reached',
      because: 'unreachable',
    };

    expect(requestCarriersAmong([readingAlone, unreachable])).toEqual([]);
  });
});
