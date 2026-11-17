import { heldForATest, keptForATest } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { patientTiming, playbookToolCalls, reportingAccess } from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp, type FakeTool } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

const decodeRefusal = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.Literal('rejected'), reason: Schema.Literal('invalid_input'), detail: Schema.String }),
);

const decodeDryRun = Schema.decodeUnknownSync(
  Schema.Struct({
    status: Schema.Literal('succeeded'),
    output: Schema.Struct({
      arguments: Schema.Struct({
        valid: Schema.Literal(false),
        issues: Schema.Tuple([Schema.Struct({ path: Schema.String, message: Schema.String })]),
      }),
    }),
  }),
);

interface BothWays {
  readonly dryRun: unknown;
  readonly executed: unknown;
  readonly sentByTheDryRun: number;
}

function agreement({ dryRun, executed, sentByTheDryRun }: BothWays) {
  const { detail } = decodeRefusal(executed);
  const [issue] = decodeDryRun(dryRun).output.arguments.issues;
  return { path: issue.path, sameAsTheCall: issue.message === detail, sentByTheDryRun };
}

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const save: FakeTool = {
  name: 'save',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
      file: { type: 'string', contentEncoding: 'base64' },
    },
    required: ['path'],
  },
  answer: () => ({ content: [{ type: 'text', text: 'saved' }] }),
};

const notes = keptForATest('019a5b12-0000-7000-8000-000000000071', 'text/markdown', '# Minutes\nAll agreed.\n');
const scan = keptForATest('019a5b12-0000-7000-8000-000000000072', 'application/pdf', Uint8Array.of(37, 80, 68, 70));
const theirs = keptForATest('019a5b12-0000-7000-8000-000000000073', 'text/plain', 'beta', {
  org: 'acme',
  playbook: 'beta',
});

async function bothWays(arguments_: Readonly<Record<string, unknown>>, mostRequestBytes?: number) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey, tools: [save] });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
  const { access } = reportingAccess(
    { graph },
    {
      timing: patientTiming,
      environment: { GRAPH_API_KEY: fakeApiKey },
      assets: heldForATest([notes, scan, theirs]),
      ...(mostRequestBytes === undefined ? {} : { mostRequestBytes }),
    },
  );
  closing.push(access.close);
  const { call } = playbookToolCalls(access);
  const asked = { server: 'graph', tool: 'save', arguments: { path: 'minutes.md', ...arguments_ } };
  const dryRun = await call('dry_run', asked);
  const sentBefore = fake.received().length;
  const executed = await call('execute_connection', asked);
  return { dryRun, executed, sentByTheDryRun: sentBefore };
}

describe('dry_run of a call that names an asset of the playbook', () => {
  it('finds the arguments valid where the tool takes what the asset holds, as the call then sends it', async () => {
    const { dryRun, executed, sentByTheDryRun } = await bothWays({ content: notes.reference, file: scan.reference });

    expect(dryRun).toMatchObject({ status: 'succeeded', output: { arguments: { valid: true, issues: [] } } });
    expect(executed).toMatchObject({ status: 'succeeded', output: { outcome: 'result' } });
    expect(sentByTheDryRun).toBe(0);
  });

  it('refuses as the call refuses, at the argument an asset the tool does not take or of another playbook, and the whole call too large', async () => {
    const asText = await bothWays({ content: scan.reference });
    const elsewhere = await bothWays({ content: theirs.reference });
    const tooLarge = await bothWays({ content: notes.reference }, 40);

    expect([agreement(asText), agreement(elsewhere), agreement(tooLarge)]).toEqual(
      ['/content', '/content', ''].map((path) => ({ path, sameAsTheCall: true, sentByTheDryRun: 0 })),
    );
  });
});
