import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { reportingAccess } from '@on.auto/tool-servers/testing';
import { Effect, Exit } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { OutputInvalid } from '../index.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { answers, textResult, toolCallsResult, type ScriptedCall, type ScriptedReply } from '../testing/index.ts';
import { reasoningWith, reasoningWithTools } from '../testing/reasoning-runs.ts';

const apiKey = 'records-api-key-7c2b4f1d9a';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function servedAs(server: string): Promise<{ readonly fake: FakeMcpServer; readonly server: string }> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return { fake, server };
}

const cut: ScriptedReply = () =>
  Effect.fail(
    new OutputInvalid({
      detail: 'anthropic stopped the answer at max_output_tokens',
      provider: 'anthropic',
      finish_reason: 'length',
      raw_finish_reason: 'max_tokens',
      usage: null,
      issues: [],
    }),
  );

async function cutAfterCalling(server: string, tools: readonly string[]): Promise<unknown> {
  const { fake } = await servedAs(server);
  const { access } = reportingAccess(
    { [server]: { url: fake.url, headers: { Authorization: 'Bearer ${RECORDS_API_KEY}' }, org: 'acme' } },
    { environment: { RECORDS_API_KEY: apiKey } },
  );
  closing.push(access.close);
  const calls = tools.map((tool): ScriptedCall => [`${server}__${tool}`, { query: 'acme' }]);
  const replies = calls.length === 0 ? [cut] : [answers(toolCallsResult(calls)), cut];
  const source = documentOf(
    `model: anthropic/claude-sonnet-4-5\nconfig: {max_output_tokens: 4000}\ntools: [${server}/*]\noutput:\n  format: json\n  schema: {type: object}`,
    'Plan the week.',
  );
  return reasoningWithTools(access, ...replies).running(source);
}

const stopped = 'anthropic stopped the answer at max_output_tokens (4000) before the JSON was complete';

function unworkable(detail: string) {
  return Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'unworkable', detail }));
}

const noToolWords =
  '; raise config.max_output_tokens in the reasoning function definition, or, where one answer holds several pieces of work, give each piece a function of its own';

const readingWords =
  ', after the run called tools that only read. Where the job always makes those reads, move each into a lookup function and hand this function what it read; or raise config.max_output_tokens in the reasoning function definition';

const actingWords =
  ', after the run called tools. Where the job always makes a call, move it out of this function, a read into a lookup function and an act into an interaction function; or raise config.max_output_tokens in the reasoning function definition';

describe('a run whose JSON answer was cut at max_output_tokens', () => {
  it('says, where it called no tool, to raise the limit or give each piece of work a function of its own', async () => {
    expect(await cutAfterCalling('records', [])).toEqual(unworkable(`${stopped}${noToolWords}`));
  });

  it('says, where every tool it called only reads, to move each read the job always makes into a lookup function, then to raise the limit', async () => {
    expect(await cutAfterCalling('records', ['search', 'profile'])).toEqual(unworkable(`${stopped}${readingWords}`));
  });

  it('says, where a tool it called may act, to move each call out, a read to a lookup function and an act to an interaction function, then to raise the limit', async () => {
    expect(await cutAfterCalling('records', ['search', 'echo'])).toEqual(unworkable(`${stopped}${actingWords}`));
  });
});

describe('the words of a cut run', () => {
  it('are the same bytes for the same facts, whatever the server and the tools were called, and name neither', async () => {
    const reading = await Promise.all([
      cutAfterCalling('records', ['search']),
      cutAfterCalling('ledgerbook', ['list_channels', 'profile']),
    ]);
    const acting = await Promise.all([
      cutAfterCalling('records', ['echo']),
      cutAfterCalling('ledgerbook', ['environment', 'search']),
    ]);

    expect(reading).toEqual([unworkable(`${stopped}${readingWords}`), unworkable(`${stopped}${readingWords}`)]);
    expect(acting).toEqual([unworkable(`${stopped}${actingWords}`), unworkable(`${stopped}${actingWords}`)]);
    expect(`${noToolWords}${readingWords}${actingWords}`).not.toMatch(
      /records|ledgerbook|search|list_channels|profile|environment|echo/u,
    );
  });
});

const inText = documentOf('model: anthropic/claude-sonnet-4-5\nconfig: {max_output_tokens: 40}', 'Summarize the week.');

describe('a run whose text answer was cut at max_output_tokens', () => {
  it('succeeds with the text it has, marked max_output_tokens, where one that stopped of itself is not marked', async () => {
    const cutText = answers(
      textResult('Profits rose in the', { finish_reason: 'length', raw_finish_reason: 'max_tokens' }),
    );
    const whole = await reasoningWith(answers(textResult('Profits rose.'))).running(inText);

    expect(await reasoningWith(cutText).running(inText)).toEqual(
      Exit.succeed(
        expect.objectContaining({ output: 'Profits rose in the', incomplete_details: { reason: 'max_output_tokens' } }),
      ),
    );
    expect(whole).toEqual(Exit.succeed(expect.objectContaining({ output: 'Profits rose.' })));
    const anyLimit: unknown = expect.anything();

    expect(whole).not.toMatchObject(Exit.succeed({ incomplete_details: anyLimit }));
  });
});
