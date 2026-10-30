import { listedTools, withMcpSession, type ListedTool, type McpSession } from '@on.auto/api/testing';
import type { ScriptedReplies } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';

import { servingReasoning } from '../servers/reasoning-server.ts';

const slackKey = 'slack-api-key-7c2e9b14';

const chatKey = 'chat-api-key-3e8b51d0';

export interface Surfaces {
  readonly instructions: string;
  readonly tools: readonly ListedTool[];
}

export interface MeetingsServer {
  readonly surfaces: Surfaces;
  readonly onMcp: <T>(use: (session: McpSession) => Promise<T>) => Promise<T>;
  readonly onPlaybook: <T>(playbook: string, use: (session: McpSession) => Promise<T>) => Promise<T>;
  readonly chat: FakeMcpServer | undefined;
  readonly stop: () => Promise<void>;
}

export interface MeetingsOptions {
  readonly chat?: boolean;
}

export function sentencesOf(text: string): readonly string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z`]|[a-z]+_[a-z_]+\b)/u);
}

export function sentenceNaming(text: string, ...words: readonly string[]): string {
  return String(sentencesOf(text).find((sentence) => words.every((word) => sentence.includes(word))));
}

export function descriptionIn({ tools }: Surfaces, tool: string): string {
  return String(tools.find(({ name }) => name === tool)?.description);
}

async function chatServing(options: MeetingsOptions) {
  if (options.chat !== true) {
    return { chat: undefined, servers: {} };
  }
  const chat = await serveFakeMcp({ bearer: chatKey, chat: true });
  const entry = {
    url: chat.url,
    headers: { Authorization: 'Bearer ${CHAT_KEY}' },
    org: 'local',
    playbooks: ['meetings'],
  };
  return { chat, servers: { chat: entry } };
}

export async function servingMeetings(
  replies: readonly ScriptedReplies[],
  options: MeetingsOptions = {},
): Promise<MeetingsServer> {
  const slack = await serveFakeMcp({ bearer: slackKey });
  const { chat, servers } = await chatServing(options);
  const server = await servingReasoning(replies, {
    SLACK_KEY: slackKey,
    CHAT_KEY: chatKey,
    NOTES_KEY: 'a-key-the-server-refuses',
    TOOL_SERVERS: JSON.stringify({
      slack: {
        url: slack.url,
        headers: { Authorization: 'Bearer ${SLACK_KEY}' },
        org: 'local',
        playbooks: ['meetings'],
      },
      notes: {
        url: slack.url,
        headers: { Authorization: 'Bearer ${NOTES_KEY}' },
        org: 'local',
        playbooks: ['meetings'],
      },
      ...servers,
    }),
  });
  const onMcp = <T>(use: (session: McpSession) => Promise<T>): Promise<T> =>
    withMcpSession('current revision', { url: `${server.origin}/mcp`, headers: {} }, use);
  const surfaces = await onMcp(async (session) => ({
    instructions: String(session.instructions),
    tools: listedTools(await session.listTools()),
  }));
  return {
    surfaces,
    chat,
    onMcp,
    onPlaybook: (playbook, use) =>
      withMcpSession(
        'current revision',
        { url: `${server.origin}/orgs/local/playbooks/${playbook}/mcp`, headers: {} },
        use,
      ),
    stop: async () => {
      await server.stop();
      await slack.close();
      await chat?.close();
    },
  };
}
