import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { createdWithGoals, servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

function goalsNamed(name: string): string {
  return [
    '- id: weekly-orders',
    `  name: ${name}`,
    '  statement: Keep the weekly orders coming in from the shop.',
    '  window: { calendar: week }',
    '  success:',
    '    label: Orders this week',
    '    settles: at_close',
    '    target: { at_least: 20 }',
    '    passed: Enough orders',
    '    failed: Too few orders',
    '',
  ].join('\n');
}

const GoalsSchema = Schema.Struct({
  version: Schema.Number,
  goals: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optionalKey(Schema.String),
      notify: Schema.optionalKey(Schema.Unknown),
      gaps: Schema.Array(Schema.Struct({ kind: Schema.String })),
    }),
  ),
});

async function goalsOf(on: ReasoningServer) {
  const read = await on.call('GET', `${alpha}/goals`);
  expect(read.status).toBe(200);
  return Schema.decodeUnknownSync(GoalsSchema)(read.body);
}

describe('the name of a goal, and a goal that leaves notify out, on a Node server', () => {
  it('saves the name as given, serves it on the goals read, and takes a new one on a later save', async () => {
    server = await servingReasoningWithGoals([]);
    const created = await createdWithGoals(server, { goals: goalsNamed('Weekly orders') });
    const first = await goalsOf(server);
    const renamed = await server.call('PUT', alpha, { body: { goals: goalsNamed('Shop orders') } });
    const second = await goalsOf(server);

    expect([created.status, renamed.status]).toEqual([201, 200]);
    expect(first.goals).toMatchObject([{ id: 'weekly-orders', name: 'Weekly orders' }]);
    expect(second).toMatchObject({ version: 2, goals: [{ id: 'weekly-orders', name: 'Shop orders' }] });
  });

  it('owes nothing for a goal with no notify: it has no notify on the read and no gap about telling', async () => {
    server = await servingReasoningWithGoals([]);
    await createdWithGoals(server, { goals: goalsNamed('Weekly orders') });
    const [goal] = (await goalsOf(server)).goals;

    expect(goal?.notify).toBeUndefined();
    expect(goal?.gaps.map(({ kind }) => kind).filter((kind) => kind.startsWith('notice_'))).toEqual([]);
  });

  it('refuses a name on two lines, at the name', async () => {
    server = await servingReasoningWithGoals([]);
    const refused = await createdWithGoals(server, { goals: goalsNamed('"Weekly\\norders"') });

    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('/0/name');
  });
});
