import { onTheStandingClock } from '@on.auto/definitions/testing';
import { toolBounds } from '@on.auto/tool-servers';
import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { interactionBounds } from '../run/run-bounds.ts';
import { callDocument, fakeTools, noConversations } from '../testing/index.ts';
import { makeInteractionFunctionAdapter } from './interaction-function.ts';
import { guideVariablesOf } from './interaction-words.ts';

const changedBy = {
  value: 'can be changed only by whoever runs the server',
  default: 'can be changed only by whoever runs the server',
};

const asThePageHasIt = {
  'interaction.most_call_arguments': { value: '16 MiB', default: '16 MiB' },
  'interaction.most_open_requests': { value: '10,000 at once', default: '10,000 at once' },
  'interaction.bounds_changed_by': changedBy,
};

describe('the values the interaction guide names', () => {
  it('are the most a call of its tool access may send and the open requests a playbook may hold, while the defaults stay the words the page writes', () => {
    expect([
      guideVariablesOf({ tools: { mostRequestBytes: 8 * 1_048_576 }, mostOpenRequests: 2500 }),
      guideVariablesOf({
        tools: { mostRequestBytes: toolBounds.requestBytes },
        mostOpenRequests: interactionBounds.openRequests,
      }),
      guideVariablesOf(),
    ]).toEqual([
      {
        'interaction.most_call_arguments': { value: '8 MiB', default: '16 MiB' },
        'interaction.most_open_requests': { value: '2,500 at once', default: '10,000 at once' },
        'interaction.bounds_changed_by': changedBy,
      },
      asThePageHasIt,
      asThePageHasIt,
    ]);
  });

  it('are those of the ports the capability is made with, the bound in the words a save past it is refused with', () => {
    const interaction = makeInteractionFunctionAdapter({
      tools: fakeTools(undefined, [], undefined, 64),
      openRequests: Function.constant(Effect.succeed(0)),
      mostOpenRequests: 3,
      conversationsOf: noConversations,
    });
    const named = interaction.guide.variables?.['interaction.most_call_arguments']?.value;
    const refused = Effect.runSync(
      Effect.flip(
        onTheStandingClock(
          interaction.prepare(callDocument({ read: null, with: [`    note: ${'x'.repeat(100)}`], input: [] })),
        ),
      ),
    );

    expect([interaction.guide.variables, JSON.stringify(refused)]).toEqual([
      {
        'interaction.most_call_arguments': { value: '64 bytes', default: '16 MiB' },
        'interaction.most_open_requests': { value: '3 at once', default: '10,000 at once' },
        'interaction.bounds_changed_by': changedBy,
      },
      expect.stringContaining(`more than the ${String(named)} a call may send to a tool server`),
    ]);
  });
});
