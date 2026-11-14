import { withMcpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReasoningServer } from '../../testing/servers/reasoning-server.ts';
import { goalsText, restatedGoalsText, servingReasoningWithGoals } from '../../testing/settings/goals-kept.ts';

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

const untilTheYes = /^Stop here: show the person its goals through the studio link/u;

const untilTheNewYes = /^Stop here: show the person the goals as saved now/u;

const unsent =
  'Auto sends no goal messages here: if the person asked to be told, tell them so first, and build a post only after their yes.';

const Structured = Schema.Struct({
  structuredContent: Schema.Struct({ before_building: Schema.optionalKey(Schema.String) }),
});

async function beforeBuildingOf(goalsMessages: boolean) {
  const on = await servingReasoningWithGoals([], undefined, undefined, { goalsMessages });
  server = on;
  return withMcpSession('current revision', { url: `${on.origin}/mcp`, headers: {} }, async (session) => {
    const answers = [
      await session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha', goals: goalsText }),
      await session.callTool('update_playbook', { playbook: 'alpha', goals: restatedGoalsText }),
      await session.callTool('agree_playbook_goals', { playbook: 'alpha', version: 2 }),
      await session.callTool('update_playbook', { playbook: 'alpha', goals: restatedGoalsText }),
      await session.callTool('update_playbook', { playbook: 'alpha', name: 'Beta' }),
      await session.callTool('get_playbook', { playbook: 'alpha' }),
    ];
    return answers.map((answer) => Schema.decodeUnknownSync(Structured)(answer).structuredContent.before_building);
  });
}

describe('before_building in the structured answers over MCP on a Node server', () => {
  it('says to stop for the yes after a create and a change, and nothing once the goals stand agreed', async () => {
    expect(await beforeBuildingOf(true)).toEqual([
      expect.stringMatching(untilTheYes),
      expect.stringMatching(untilTheNewYes),
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('adds, with messages off, that Auto sends no goal messages after every save of goals and every yes', async () => {
    const [created, changed, ...after] = await beforeBuildingOf(false);

    expect([created?.endsWith(` ${unsent}`), changed?.endsWith(` ${unsent}`)]).toEqual([true, true]);
    expect(after).toEqual([unsent, unsent, undefined, undefined]);
  });
});
