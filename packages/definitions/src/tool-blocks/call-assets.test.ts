import { compileJsonSchema } from '@on.auto/json-schema';
import { allPermissions, Conflict, InvalidInput } from '@on.auto/operations';
import type { AssetNotSentOnce, CalledOnce, OneCall } from '@on.auto/tool-servers';
import { Effect, Exit, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunContext } from '../capability/run-context.ts';
import { recordingJournal } from '../journal-testing/recording-journal.ts';
import { noCalledDefinitions } from '../testing/called-definitions.ts';
import { onTheStandingClock } from '../testing/time/stepping-clock.ts';
import { callRunOf, type CallingDocument } from './call-run.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const context: RunContext = {
  id: runId,
  org: 'acme',
  playbook: 'alpha',
  caller: { id: 'acme-admin', name: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' },
  definition: { name: 'save-the-page', version: 1 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: runId },
  depth: 0,
  callDepth: 0,
  ...noCalledDefinitions,
};

const anything = Result.getOrThrow(compileJsonSchema({}, { what: 'output', nesting: 512 }));

const openInput = Result.getOrThrow(compileJsonSchema({ type: 'object' }, { what: 'input', nesting: 512 }));

const saving: CallingDocument = {
  input: { schema: openInput },
  call: { server: 'files', tool: 'save', with: { content: '{{ input.page }}' } },
  output: { schema: anything },
};

function endedWith(refused: AssetNotSentOnce) {
  const run = callRunOf(
    { tools: { callOnce: () => Effect.succeed(refused), mostRequestBytesTo: () => 1_048_576 } },
    { noun: 'interaction function' },
  );
  return Effect.runPromiseExit(onTheStandingClock(run(saving, { page: 'the page' }, context)));
}

function notSent(because: AssetNotSentOnce['because'], detail: string): AssetNotSentOnce {
  return { kind: 'unopened', refused: 'asset_not_sent', because, pointer: '/content', detail };
}

describe('a call block whose asset was not sent', () => {
  it('rejects the run as invalid input where the asset cannot be used, since another input may name one that can', async () => {
    const detail = 'The argument /content names an asset that cannot be sent: The asset a has expired';

    expect(await endedWith(notSent('asset_unusable', detail))).toEqual(
      Exit.fail(new InvalidInput({ detail, issues: [{ pointer: '', detail }] })),
    );
  });

  it('rejects the run as unworkable at the argument where the tool takes no such asset, or the call would be too large', async () => {
    const notTaken = 'The argument /content is a file of image/png, and the save tool of files takes text there';
    const tooLarge = 'The arguments of this call take 9000000 bytes with the assets they send, more than the 8 MiB';

    expect([
      await endedWith(notSent('asset_not_taken', notTaken)),
      await endedWith(notSent('too_large', tooLarge)),
    ]).toEqual([
      Exit.fail(new Conflict({ detail: notTaken, kind: 'unworkable', record: { pointer: '/call/with/content' } })),
      Exit.fail(new Conflict({ detail: tooLarge, kind: 'unworkable', record: { pointer: '/call/with/content' } })),
    ]);
  });
});

const typedInput = Result.getOrThrow(
  compileJsonSchema(
    {
      type: 'object',
      properties: { page: { type: 'string', maxLength: 10 }, rows: { type: 'array' }, photo: { type: 'string' } },
    },
    { what: 'input', nesting: 512 },
  ),
);

const answered: CalledOnce = {
  kind: 'answered',
  mark: 'acts',
  detail: '',
  retryAfterMs: null,
  outcome: 'result',
  answer: { content: [], structuredContent: { saved: true } },
  answered: { is_error: false, result_bytes: 14, duration_ms: 3, jsonrpc_id: 1 },
};

function assetOf(mediaType: string) {
  return { id: 'a', media_type: mediaType, bytes: 3, sha256: 'a'.repeat(64), address: null, address_until: null };
}

async function sentWith(input: Schema.Json) {
  const sent: OneCall[] = [];
  const run = callRunOf(
    {
      tools: {
        callOnce: (call) => {
          sent.push(call);
          return Effect.succeed(answered);
        },
        mostRequestBytesTo: () => 1_048_576,
      },
    },
    { noun: 'interaction function' },
  );
  const passing: CallingDocument = {
    input: { schema: typedInput },
    call: { server: 'files', tool: 'save', with: { content: '{{ input }}' } },
    output: { schema: anything },
  };
  const ended = await Effect.runPromiseExit(onTheStandingClock(run(passing, input, context)));
  return { ended, sent };
}

describe('the input of a call block that holds an asset', () => {
  it('takes a text or a JSON asset where its schema takes what the asset holds, and passes it whole', async () => {
    const input = { page: assetOf('text/markdown'), rows: assetOf('application/json'), notes: assetOf('text/plain') };

    const { ended, sent } = await sentWith(input);

    expect(Exit.isSuccess(ended)).toBe(true);
    expect(sent.map(({ input: given }) => given)).toEqual([{ content: input }]);
  });

  it('refuses a file where its schema takes text, as it refuses any other value it does not take', async () => {
    const lookalike = { ...assetOf('text/plain'), media_type: 7 };

    const asText = await sentWith({ photo: assetOf('image/png') });
    const notAnAsset = await sentWith({ page: lookalike });

    expect([asText.ended, notAnAsset.ended]).toEqual([
      Exit.fail(expect.objectContaining({ _tag: 'invalid_input', kind: 'input_schema' })),
      Exit.fail(expect.objectContaining({ _tag: 'invalid_input', kind: 'input_schema' })),
    ]);
    expect([...asText.sent, ...notAnAsset.sent]).toEqual([]);
  });
});
