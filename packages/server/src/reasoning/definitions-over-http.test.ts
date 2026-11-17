import { withMcpSession } from '@on.auto/api/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aLedgerHoldingAReasoningFunctionSavedEarlierAt } from '../testing/records/a-ledger-of-another-version.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha, noNetwork, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';

const seventeenOptionalFields = Object.fromEntries(
  Array.from({ length: 17 }, (_, index) => [`field${index}`, { type: 'string' }]),
);

const overTheBudgetWarning =
  'Line 5, /output/schema: answers to this schema cannot be enforced while a model writes them: 17 fields that may be null or are a choice of types, counted where each definition is used (most 16). Answers are checked after the model writes them. To have them enforced, make some of these fields required and of one type, or split the answer.';

function scoring(properties: object): string {
  return [
    '---',
    'model: anthropic/claude-sonnet-4-5',
    'output:',
    '  format: json',
    `  schema: ${JSON.stringify({ type: 'object', properties, additionalProperties: false })}`,
    '---',
    'Score {{ input.text }}',
  ].join('\n');
}

const summary = [
  '---',
  'model: anthropic/claude-sonnet-4-5',
  'description: Summarizes a text',
  'input:',
  '  schema: {type: object, properties: {text: {type: string}}, required: [text]}',
  '---',
  '{% system %}Be brief.{% endsystem %}Summarize: {{ input.text }}',
].join('\n');

let server: ReasoningServer;

function creating(name: string, source: string) {
  return server.call('POST', `${alpha}/definitions/reasoning`, { body: { name, source, diagram: 'none' } });
}

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

let ledger: TemporaryLedger | undefined;

async function onAlpha(shared?: TemporaryLedger): Promise<void> {
  server = await servingReasoning([], {}, noNetwork, shared === undefined ? {} : { ledger: shared });
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
}

describe('definitions over http', () => {
  beforeEach(async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('the reasoning function definitions of a playbook over HTTP', () => {
    it('creates a definition with 201, with what the capability says about it', async () => {
      expect(await creating('summary', summary)).toMatchObject({
        status: 201,
        body: {
          type: 'reasoning',
          name: 'summary',
          version: 1,
          status: 'active',
          media_type: 'text/markdown',
          description: 'Summarizes a text',
          input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          source: summary,
        },
      });
    });
  });

  describe('the life of a reasoning function definition over HTTP', () => {
    it('lists, reads, updates and retires a definition', async () => {
      await creating('summary', summary);
      const listed = await server.call('GET', `${alpha}/definitions/reasoning`);
      const read = await server.call('GET', `${alpha}/definitions/reasoning/summary`);
      const updated = await server.call('PUT', `${alpha}/definitions/reasoning/summary`, {
        body: { source: summary.replace('Be brief.', 'Be very brief.'), diagram: 'none' },
      });
      const retired = await server.call('POST', `${alpha}/definitions/reasoning/summary/retire`);

      expect(listed).toMatchObject({
        status: 200,
        body: { definitions: [{ name: 'summary', description: 'Summarizes a text' }] },
      });
      expect(listed.body).not.toHaveProperty('definitions.0.source');
      expect(read).toMatchObject({ status: 200, body: { name: 'summary', version: 1, source: summary } });
      expect(updated).toMatchObject({ status: 200, body: { version: 2 } });
      expect(retired).toMatchObject({ status: 200, body: { status: 'retired' } });
    });

    it('shows no warnings for a JSON definition whose answers can be enforced, and a warning where they cannot', async () => {
      const created = await creating('score', scoring({ score: { type: 'integer', maximum: 10 } }));
      const overTheBudgetDefinitions = await creating('profile', scoring(seventeenOptionalFields));

      expect(created).toMatchObject({ status: 201, body: { name: 'score' } });
      expect(created.body).not.toHaveProperty('warnings');
      expect(overTheBudgetDefinitions).toMatchObject({ status: 201, body: { warnings: [overTheBudgetWarning] } });
    });
  });

  describe('a reasoning function definition document that is not valid', () => {
    it('is rejected with 422, with the line of the problem under /source, and nothing is saved', async () => {
      const rejected = await creating('broken', '---\nmodel: gpt-5\n---\nHi');
      const atTheModel: unknown = expect.stringMatching(/^Line 2, \/model: /u);

      expect(rejected).toMatchObject({
        status: 422,
        body: {
          reason: 'invalid_input',
          errors: [{ pointer: '/source', detail: atTheModel }],
        },
      });
      expect((await server.call('GET', `${alpha}/definitions/reasoning`)).body).toEqual({ definitions: [] });
    });
  });
});

describe('definition warnings', () => {
  afterEach(async () => {
    await server.stop();
    ledger?.remove();
    ledger = undefined;
  });

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
});
