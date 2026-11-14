import { openApiPath } from '@on.auto/api';
import { plainTextIn, toolNamesIn, withMcpSession } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../../testing/servers/reasoning-server.ts';
import {
  createdWithGoals,
  goalsText,
  leadGoalId,
  plainGoalId,
  restatedGoalsText,
  servingReasoningWithGoals,
} from '../../testing/settings/goals-kept.ts';

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function served(serving: typeof servingReasoning): Promise<ReasoningServer> {
  const on = await serving([]);
  server = on;
  return on;
}

const AgreedOfEach = Schema.Struct({
  goals: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      agreed: Schema.optionalKey(Schema.Struct({ at: Schema.String, by: Schema.String, version: Schema.Number })),
    }),
  ),
});

async function agreedVersionsOf(on: ReasoningServer) {
  const { goals } = Schema.decodeUnknownSync(AgreedOfEach)((await on.call('GET', `${alpha}/goals`)).body);
  return goals.map(({ id, agreed }) => ({ id, version: agreed?.version }));
}

const changedSinceOne: unknown = expect.stringMatching(
  /^The goals changed after version 1, and are at version 2 now\./u,
);

const ChangesBody = Schema.Struct({ cursor: Schema.String, changes: Schema.Array(Schema.Unknown) });

describe('agreeing the goals on a Node server that keeps goals', () => {
  it('records the yes at POST /goals/agreed, shows it on the goals read and names a goal change', async () => {
    const on = await served(servingReasoningWithGoals);
    await createdWithGoals(on);
    const { cursor } = Schema.decodeUnknownSync(ChangesBody)((await on.call('GET', `${alpha}/changes`)).body);

    const agreed = await on.call('POST', `${alpha}/goals/agreed`, { body: { version: 1 } });
    const changes = await on.call('GET', `${alpha}/changes?since=${cursor}&wait=0`);

    expect(agreed).toMatchObject({
      status: 200,
      body: { version: 1, goals: [{ id: leadGoalId, agreed: { version: 1 } }, { id: plainGoalId }] },
    });
    expect(await agreedVersionsOf(on)).toEqual([
      { id: leadGoalId, version: 1 },
      { id: plainGoalId, version: 1 },
    ]);
    expect(changes).toMatchObject({ status: 200, body: { changes: [{ kind: 'goal' }] } });
  });

  it('drops the yes of a goal saved with a change, and refuses a yes to the version the person saw before', async () => {
    const on = await served(servingReasoningWithGoals);
    await createdWithGoals(on);
    await on.call('POST', `${alpha}/goals/agreed`, { body: { version: 1 } });
    await on.call('PUT', alpha, { body: { goals: restatedGoalsText } });

    const changed = await agreedVersionsOf(on);
    const late = await on.call('POST', `${alpha}/goals/agreed`, { body: { version: 1 } });

    expect(changed).toEqual([
      { id: leadGoalId, version: undefined },
      { id: plainGoalId, version: 1 },
    ]);
    expect(late).toMatchObject({
      status: 409,
      body: { detail: changedSinceOne },
    });
  });
});

describe('agree_playbook_goals over MCP', () => {
  it('is a tool where goals are kept, which an agent calls after the yes, and none where they are not', async () => {
    const without = await served(servingReasoning);
    const toolsWithout = await withMcpSession(
      'current revision',
      { url: `${without.origin}/mcp`, headers: {} },
      async (session) => toolNamesIn(await session.listTools()),
    );
    await without.stop();
    const on = await served(servingReasoningWithGoals);

    const { tools, answer } = await withMcpSession(
      'current revision',
      { url: `${on.origin}/mcp`, headers: {} },
      async (session) => {
        await session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha', goals: goalsText });
        return {
          tools: toolNamesIn(await session.listTools()),
          answer: await session.callTool('agree_playbook_goals', { playbook: 'alpha', version: 1, ids: [leadGoalId] }),
        };
      },
    );

    expect(toolsWithout).not.toContain('agree_playbook_goals');
    expect(tools).toContain('agree_playbook_goals');
    expect(plainTextIn(answer)).toContain(
      `Recorded the person's yes to version 1 of the goals. Still waiting for a yes: ${plainGoalId}.`,
    );
  });
});

describe('the answers that save or agree goals over MCP where Auto sends no goal messages', () => {
  const unsent =
    'Auto sends no goal messages here: if the person asked to be told, tell them so first, and build a post only after their yes.';

  async function answersOf(goalsMessages: boolean) {
    const on = await served((replies) => servingReasoningWithGoals(replies, undefined, undefined, { goalsMessages }));
    return withMcpSession('current revision', { url: `${on.origin}/mcp`, headers: {} }, async (session) => {
      const created = await session.callTool('create_playbook', {
        playbook: 'alpha',
        name: 'Customer support escalations',
        description: 'Answers every customer email within a day, and hands the hard ones to a lead. '.repeat(3),
        goals: goalsText,
      });
      const updated = await session.callTool('update_playbook', { playbook: 'alpha', goals: restatedGoalsText });
      const renamed = await session.callTool('update_playbook', { playbook: 'alpha', name: 'Alpha one' });
      const agreed = await session.callTool('agree_playbook_goals', { playbook: 'alpha', version: 2 });
      return [created, updated, renamed, agreed].map((answer) => plainTextIn(answer).includes(unsent));
    });
  }

  it('tell the agent after a create with a long name and purpose, an update that saves goals and a yes, and not after an update that leaves them', async () => {
    expect(await answersOf(false)).toEqual([true, true, false, true]);
  });

  it('say nothing of it where goal messages are sent', async () => {
    expect(await answersOf(true)).toEqual([false, false, false, false]);
  });
});

describe('the API document of a server that keeps goals', () => {
  it('lists agree_playbook_goals under the goals tag', async () => {
    const on = await served(servingReasoningWithGoals);
    const { body } = await on.call('GET', openApiPath);

    expect(body).toMatchObject({
      paths: {
        '/orgs/{org}/playbooks/{playbook}/goals/agreed': {
          post: { operationId: 'agree_playbook_goals', tags: ['goals'] },
        },
      },
    });
  });
});
