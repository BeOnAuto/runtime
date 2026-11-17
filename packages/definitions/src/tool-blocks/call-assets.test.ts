import { compileJsonSchema } from '@on.auto/json-schema';
import { allPermissions, Conflict, InvalidInput, noAssetsHeld } from '@on.auto/operations';
import { heldForATest, keptForATest } from '@on.auto/operations/testing';
import type { AssetNotSentOnce, CalledOnce, OneCall } from '@on.auto/tool-servers';
import { Effect, Exit, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunContext } from '../capability/run-context.ts';
import { noCalledDefinitions, onTheStandingClock, recordingJournal } from '../testing/index.ts';
import { callRunOf, type CallingDocument } from './call-run.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const anyText: unknown = expect.any(String);

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
    { tools: { assets: noAssetsHeld, callOnce: () => Effect.succeed(refused), mostRequestBytesTo: () => 1_048_576 } },
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
        assets: noAssetsHeld,
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

const page = keptForATest('019a5b12-0000-7000-8000-000000000011', 'text/markdown', 'Prices went up.');
const rows = keptForATest('019a5b12-0000-7000-8000-000000000012', 'application/json', '{"rows":[1,2]}');
const photo = keptForATest('019a5b12-0000-7000-8000-000000000013', 'image/png', new Uint8Array([137, 80]));
const theirs = keptForATest('019a5b12-0000-7000-8000-000000000014', 'text/plain', 'theirs', {
  org: 'acme',
  playbook: 'beta',
});

function savingWith(arguments_: Schema.JsonObject): CallingDocument {
  return {
    input: { schema: openInput },
    call: { server: 'files', tool: 'save', with: arguments_ },
    output: { schema: anything },
  };
}

async function readThrough(document: CallingDocument, input: Schema.Json, mostBytes = 1_048_576) {
  const calls: OneCall[] = [];
  const holding = heldForATest([page, rows, photo, theirs]);
  const run = callRunOf(
    {
      tools: {
        assets: holding,
        callOnce: (call) => {
          calls.push(call);
          return Effect.succeed(answered);
        },
        mostRequestBytesTo: () => mostBytes,
      },
    },
    { noun: 'interaction function' },
  );
  const ended = await Effect.runPromiseExit(onTheStandingClock(run(document, input, context)));
  return { ended, sent: calls.map(({ input: given }) => given), opened: holding.opened() };
}

const notTextAmongText = Exit.fail(
  expect.objectContaining({ _tag: 'conflict', kind: 'unworkable', record: { pointer: '/call/with/content' } }),
);

describe('a call block that mixes a kept text or JSON value into text', () => {
  it('reads it into the text it renders, and passes the same asset whole where a template is one expression', async () => {
    const document = savingWith({
      content: '# Copy\n\n{{ input.page }}',
      count: 'Rows: {{ input.rows.rows | size }}',
      whole: '{{ input.page }}',
    });

    const { ended, sent, opened } = await readThrough(document, { page: page.reference, rows: rows.reference });

    expect(Exit.isSuccess(ended)).toBe(true);
    expect(sent).toEqual([{ content: '# Copy\n\nPrices went up.', count: 'Rows: 2', whole: page.reference }]);
    expect(opened).toBe(2);
  });

  it('reads nothing when every template that reads an asset passes it whole', async () => {
    const { sent, opened } = await readThrough(savingWith({ whole: '{{ input.page }}' }), { page: page.reference });

    expect([sent, opened]).toEqual([[{ whole: page.reference }], 0]);
  });
});

describe('a call block whose one expression applies a filter', () => {
  it('reads a kept text or JSON value inside before the filter, and keeps what the filter answers as it is', async () => {
    const document = savingWith({
      stripped: '{{ input.page | strip }}',
      quoted: '{{ input.page | json }}',
      listed: '{{ input.rows | json }}',
      first: '{{ input.rows.rows | first }}',
      count: '{{ input.n | plus: 1 }}',
    });

    const { ended, sent } = await readThrough(document, { page: page.reference, rows: rows.reference, n: 1 });

    expect(Exit.isSuccess(ended)).toBe(true);
    expect(sent).toEqual([
      { stripped: 'Prices went up.', quoted: '"Prices went up."', listed: '{"rows":[1,2]}', first: 1, count: 2 },
    ]);
  });

  it('writes the description of a kept file with | json, and passes it on whole where the filter answers it', async () => {
    const document = savingWith({ described: '{{ input.photo | json }}', kept: '{{ input.photos | first }}' });

    const { sent } = await readThrough(document, { photo: photo.reference, photos: [photo.reference] });

    expect(sent).toEqual([{ described: JSON.stringify(photo.reference), kept: photo.reference }]);
  });
});

describe('a call block that writes a kept file as text', () => {
  it('refuses it at its argument, through a filter that needs text or mixed into text, as it refuses an object there, and sends nothing', async () => {
    const input = { photo: photo.reference, photos: [photo.reference], object: { a: 1 } };
    const contents = [
      '{{ input.photo | upcase }}',
      'See {{ input.photo | clip: 5 }}',
      'See {{ input.photos | join: ", " }}',
      'See {{ input.photo }}',
      'See {{ input.object }}',
    ];

    const ran = await Promise.all(contents.map((content) => readThrough(savingWith({ content }), input)));

    expect(ran[0]).toEqual({ ended: notTextAmongText, sent: [], opened: 0 });
    expect(ran).toEqual(contents.map(() => ran[0]));
  });
});

describe('a call block that cannot read what it mixes into text', () => {
  it('refuses an asset of another playbook as invalid input at its place, and a text larger than the call may send as unworkable', async () => {
    const document = savingWith({ content: '# Copy\n\n{{ input.page }}' });

    const elsewhere = await readThrough(document, { page: theirs.reference });
    const tooLarge = await readThrough(document, { page: page.reference }, page.reference.bytes - 1);

    expect([elsewhere.ended, tooLarge.ended]).toEqual([
      Exit.fail(expect.objectContaining({ _tag: 'invalid_input', issues: [{ pointer: '/page', detail: anyText }] })),
      Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'unworkable' })),
    ]);
    expect([...elsewhere.sent, ...tooLarge.sent, tooLarge.opened]).toEqual([0]);
  });
});
