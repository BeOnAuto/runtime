import type { ToolServer } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { signInDocument } from '../sign-in-testing/sign-in-documents.ts';
import { signInTools } from '../sign-in-testing/sign-in-tools.ts';
import { interactionHarness, noTools, type HarnessTools } from '../testing/index.ts';

const aChatOfTheSettings: ToolServer = {
  name: 'chat',
  type: 'mcp',
  record_content: true,
  playbooks: ['*'],
  provider: null,
  tools: [
    {
      name: 'post_message',
      description: 'Posts a message to a channel or a thread.',
      input_schema: { type: 'object', properties: { channel: { type: 'string' } } },
      mark: 'unmarked',
      marked_by: 'server',
    },
  ],
};

function savedAs(source: string, tools: HarnessTools = signInTools()) {
  return interactionHarness({ tools }).define('supplier-portal-sign-in', source);
}

const aProblem = 'The interaction function definition has a problem';

const deliverWords: unknown = expect.stringMatching(
  /^Line 1, \/deliver: Say how the person is reached when a run asks them to sign in: deliver names the tool of a connection that sends the request, or deliver: agent holds it for Studio and their agent\. This playbook can send it through the connection chat \(post_message\)\.$/u,
);

describe('the save of a sign-in function that leaves out whether a run waits', () => {
  it('is refused with the line of sign_in, and offers to wait or to stop, each saying what to write', async () => {
    expect(await savedAs(signInDocument({ ifSignedOut: null }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: aProblem,
      issues: [
        {
          pointer: '/source',
          detail:
            'Line 4, /sign_in/if_signed_out: sign_in.if_signed_out is required: ask the person whether a run waits for them to sign in to portal.supplier.example, ask, or stops at once, fail',
        },
      ],
      options: {
        question: "When you're not signed in to portal.supplier.example, should a run wait for you?",
        choices: [
          {
            value: 'ask',
            title: 'Wait for me to sign in',
            issues: [
              {
                pointer: '/source',
                detail:
                  'Line 4, /sign_in/if_signed_out: Write sign_in.if_signed_out: ask, with deliver, expires and the message that asks them',
              },
            ],
          },
          {
            value: 'fail',
            title: 'Stop at once',
            issues: [
              {
                pointer: '/source',
                detail:
                  'Line 4, /sign_in/if_signed_out: Write sign_in.if_signed_out: fail, with no deliver, expires or message',
              },
            ],
          },
        ],
      },
    });
  });
});

describe('the save of a sign-in function that waits and leaves out how long', () => {
  it('is refused, offering an hour, a day or a week', async () => {
    expect(await savedAs(signInDocument({ expires: null }))).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [
        {
          detail:
            'Line 1, /expires: expires is required with if_signed_out: ask: ask the person how long a run waits for them to sign in, an ISO 8601 duration from one minute to thirty days, such as P1D',
        },
      ],
      options: {
        question: 'How long should a run wait for you to sign in to portal.supplier.example?',
        choices: [
          { value: 'PT1H', title: 'An hour', issues: [{ detail: 'Line 1, /expires: Write expires: PT1H' }] },
          { value: 'P1D', title: 'A day', issues: [{ detail: 'Line 1, /expires: Write expires: P1D' }] },
          { value: 'P7D', title: 'A week', issues: [{ detail: 'Line 1, /expires: Write expires: P7D' }] },
        ],
      },
    });
  });
});

describe('the save of a sign-in function that waits and leaves out where to reach the person', () => {
  it('is refused, offering each connection that can send it and Studio or their agent', async () => {
    expect(await savedAs(signInDocument({ deliver: [] }))).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ detail: deliverWords }],
      options: {
        question: 'Where should a run ask you to sign in to portal.supplier.example?',
        choices: [
          { value: 'connection:chat', title: 'chat' },
          {
            value: 'agent',
            title: 'Studio or your agent',
            issues: [
              {
                detail:
                  'Line 1, /deliver: Write deliver: agent: Studio lists the request for the person, and their agent reads it with list_interactions',
              },
            ],
          },
        ],
      },
    });
  });

  it('offers a tool server of the settings that can send it by its kind', async () => {
    const settings: HarnessTools = { ...noTools, listServers: () => Effect.succeed([aChatOfTheSettings]) };

    expect(await savedAs(signInDocument({ deliver: [] }), settings)).toMatchObject({
      options: { choices: [{ value: 'tool_server:chat' }, { value: 'agent' }] },
    });
  });

  it('offers Studio or their agent alone where no connection can send it', async () => {
    expect(await savedAs(signInDocument({ deliver: [] }), noTools)).toMatchObject({
      status: 'rejected',
      options: { choices: [{ value: 'agent', title: 'Studio or your agent' }] },
    });
  });
});

describe('the save of a sign-in function with every answer', () => {
  it('is saved, whether it waits or stops', async () => {
    expect([
      await savedAs(signInDocument()),
      await savedAs(signInDocument({ ifSignedOut: 'fail', expires: null, deliver: [], body: '' })),
    ]).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
  });
});
