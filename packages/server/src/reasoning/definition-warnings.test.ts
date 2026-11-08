import { withMcpSession } from '@on.auto/api/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { aLedgerHoldingAReasoningFunctionSavedEarlierAt } from '../testing/records/a-ledger-of-another-version.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, noNetwork, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const seventeenOptionalFields = Object.fromEntries(
  Array.from({ length: 17 }, (_, index) => [`field${index}`, { type: 'string' }]),
);

const profileSchema = { type: 'object', properties: seventeenOptionalFields, additionalProperties: false };

const profile = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'output:',
  '  format: json',
  `  schema: ${JSON.stringify(profileSchema)}`,
  '---',
  'Profile {{ input.text }}',
].join('\n');

const overTheBudget =
  'Line 5, /output/schema: answers to this schema cannot be enforced while a model writes them: 17 fields that may be null or are a choice of types, counted where each definition is used (most 16). Answers are checked after the model writes them. To have them enforced, make some of these fields required and of one type, or split the answer.';

const warnedWhenSaved = `Line 5, /output/schema/required: Every property should be required (make an optional one nullable instead): ${Object.keys(seventeenOptionalFields).join(', ')} (openai, azure)`;

let server: ReasoningServer;

let ledger: TemporaryLedger | undefined;

afterEach(async () => {
  await server.stop();
  ledger?.remove();
  ledger = undefined;
});

async function onAlpha(shared?: TemporaryLedger): Promise<void> {
  server = await servingReasoning([], {}, noNetwork, shared === undefined ? {} : { ledger: shared });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
}

describe('a reasoning function definition whose answers cannot be enforced, read through MCP', () => {
  it('tells the agent so in get_definition, with how to have them enforced', async () => {
    await onAlpha();
    const read = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
      async (session) => {
        await session.callTool('create_definition', {
          type: 'reasoning',
          name: 'profile',
          source: profile,
          diagram: 'none',
        });
        return session.callTool('get_definition', { type: 'reasoning', name: 'profile' });
      },
    );

    expect(read.structuredContent).toMatchObject({ name: 'profile', warnings: [overTheBudget] });
  });
});

describe('a reasoning function definition saved by an earlier release', () => {
  it('is read and listed with the warnings of this release, not the ones it was saved with', async () => {
    ledger = temporaryLedger();
    await aLedgerHoldingAReasoningFunctionSavedEarlierAt(ledger.fileName, {
      name: 'profile',
      source: profile,
      outputSchema: profileSchema,
      warnings: [warnedWhenSaved],
    });
    await onAlpha(ledger);

    expect([
      await server.call('GET', `${alpha}/definitions/reasoning/profile`),
      await server.call('GET', `${alpha}/definitions/reasoning`),
    ]).toMatchObject([
      { status: 200, body: { name: 'profile', source: profile, warnings: [overTheBudget] } },
      { status: 200, body: { definitions: [{ name: 'profile', warnings: [overTheBudget] }] } },
    ]);
  });
});
