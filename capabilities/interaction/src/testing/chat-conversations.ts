import { Effect } from 'effect';

import type { ConversationsOf, ConversationTools } from '../tellings/telling-routes.ts';

export const noConversations: ConversationsOf = () => Effect.undefined;

export const chatConversations: ConversationTools = {
  tell: 'all',
  automatic: '/bot_id',
  reply: {
    tool: 'post_message',
    with: {
      channel: '{{ sent.conversation }}',
      thread_ts: '{{ reply.to | default: reply.id | default: sent.id }}',
      text: '{{ message }}',
    },
    sent: '/ts',
  },
  react: {
    tool: 'add_reaction',
    with: { channel: '{{ sent.conversation }}', timestamp: '{{ reply.id }}', name: 'white_check_mark' },
  },
};
