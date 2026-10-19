import { plainTextIn, problemIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { campaignPace } from '@on.auto/computation/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProgramPoolOf } from '../composition/served-computation.ts';
import { checkRefusals, documentOf } from '../testing/servers/check-refusals.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { patientWorkerPool } from '../testing/servers/worker-pools.ts';

const misspelt = [
  '---',
  'language: typescript',
  'input:',
  '  schema: {type: object, required: [period], properties: {period: {type: integer}}}',
  '---',
  'export default function (input: Input): Output {',
  '  return input.perod;',
  '}',
].join('\n');

type ToolResult = Awaited<ReturnType<McpSession['callTool']>>;

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

function stallingChecks(): {
  readonly stall: (because: 'deadline' | 'busy') => void;
  readonly poolOf: ProgramPoolOf;
} {
  const state: { because?: 'deadline' | 'busy' } = {};
  return {
    stall: (because) => {
      state.because = because;
    },
    poolOf: (settings) => {
      const pool = patientWorkerPool(settings);
      return {
        ...pool,
        check: (request, signal) =>
          state.because === undefined
            ? pool.check(request, signal)
            : Promise.resolve({ ran: 'stopped', because: state.because, milliseconds: 2000 }),
      };
    },
  };
}

async function onAlpha<T>(programPoolOf: ProgramPoolOf, use: (session: McpSession) => Promise<T>): Promise<T> {
  server = await servingReasoning([], {}, undefined, { programPoolOf });
  await withMcpSession('current revision', { url: `${server.origin}/orgs/acme/mcp`, headers: {} }, (session) =>
    session.callTool('create_playbook', { playbook: 'alpha', name: 'Alpha' }),
  );
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

describe('a computation function checked when it is saved, over MCP', () => {
  it('answers a refused program with isError, its line and the compiler’s words, in plain words', async () => {
    const created = await onAlpha(patientWorkerPool, (session) =>
      session.callTool('create_definition', { type: 'computation', name: 'misspelt', source: misspelt }),
    );

    expect({ isError: created.isError, problem: problemIn(created) }).toMatchObject({
      isError: true,
      problem: {
        status: 422,
        reason: 'invalid_input',
        errors: [
          {
            pointer: '/source',
            detail: "Line 7: Property 'perod' does not exist on type 'Input'. Did you mean 'period'?",
          },
        ],
      },
    });
    expect(internalTermsIn(plainTextIn(created))).toEqual([]);
  });
});

describe('each refusal of the check at save, over MCP', () => {
  it('answers each refusal of the check with isError, its line and its words, as over HTTP', async () => {
    const created = await onAlpha(patientWorkerPool, (session) =>
      checkRefusals.reduce<Promise<readonly ToolResult[]>>(
        async (before, [, program], index) => [
          ...(await before),
          await session.callTool('create_definition', {
            type: 'computation',
            name: `refused-${index}`,
            source: documentOf(program),
          }),
        ],
        Promise.resolve([]),
      ),
    );

    expect(created.map((result) => ({ isError: result.isError, problem: problemIn(result) }))).toMatchObject(
      checkRefusals.map(([, , details]) => ({
        isError: true,
        problem: {
          status: 422,
          reason: 'invalid_input',
          errors: details.map((detail) => ({ pointer: '/source', detail })),
        },
      })),
    );
  });
});

describe('a check at save that does not answer in time, or has no checker ready, over MCP', () => {
  it('answers invalid input when the check runs past its deadline, and unavailable, on a create and an update, when no checker is ready', async () => {
    const { stall, poolOf } = stallingChecks();
    const saved = await onAlpha(poolOf, async (session) => {
      await session.callTool('create_definition', { type: 'computation', name: 'pace', source: campaignPace });
      stall('deadline');
      const tooLong = await session.callTool('create_definition', {
        type: 'computation',
        name: 'slow',
        source: campaignPace,
      });
      stall('busy');
      return [
        tooLong,
        await session.callTool('create_definition', { type: 'computation', name: 'again', source: campaignPace }),
        await session.callTool('update_definition', {
          type: 'computation',
          name: 'pace',
          source: `${campaignPace}\n`,
        }),
      ];
    });
    const unavailable = { isError: true, problem: { status: 503, reason: 'unavailable' } };

    expect(saved.map((result) => ({ isError: result.isError, problem: problemIn(result) }))).toMatchObject([
      { isError: true, problem: { status: 422, reason: 'invalid_input', errors: [{ pointer: '/source' }] } },
      unavailable,
      unavailable,
    ]);
  });
});
