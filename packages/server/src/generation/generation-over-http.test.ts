import { assets } from '@on.auto/generation';
import { askedHandle, filmedBytes, onePixelPng, shippedWithAFilm, spokenBytes } from '@on.auto/generation/testing';
import { projectedTableOf } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { everyRowSet, onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import {
  gatewayOnTheLoopback,
  type GatewayOnTheLoopback,
  type GenerationServer,
  servingGeneration,
} from '../testing/servers/generation-server.ts';
import { alpha, type ReasoningServer, servingReasoning } from '../testing/servers/reasoning-server.ts';
import { blocksInOrderOf } from '../testing/servers/tutorial-calls.ts';
import { runIdIn, settledAsSwept, workflowSource } from '../testing/servers/workflow-server.ts';
import {
  steppedServerClock,
  testServersStartAt,
  type SteppedServerClock,
} from '../testing/waiting/stepped-server-clock.ts';
import { whenHeld } from '../testing/waiting/until.ts';

const picture = [
  '---',
  'description: A picture of the product for its listing',
  'produces: image',
  'model: gateway/openai/gpt-image-2',
  'input:',
  '  schema: { type: object, required: [product], properties: { product: { type: string } } }',
  'parameters: { size: 1024x1024, quality: high }',
  '---',
  'A studio photograph of {{ input.product }} on a white table.',
].join('\n');

const welcome = ['---', 'produces: audio', 'model: gateway/openai/tts-1', '---', 'Welcome to the corner shop.'].join(
  '\n',
);

const RunSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output_shape: Schema.Literal('asset'),
  output: Schema.Struct({
    id: Schema.String,
    media_type: Schema.String,
    bytes: Schema.Int,
    sha256: Schema.String,
    address: Schema.String,
    address_until: Schema.NullOr(Schema.String),
  }),
  record: Schema.Struct({ model: Schema.String, own_key: Schema.Boolean, cost_usd: Schema.Number }),
});

const runOf = Schema.decodeUnknownSync(RunSchema);

const ReadSchema = Schema.Struct({
  id: Schema.String,
  media_type: Schema.String,
  bytes: Schema.Int,
  sha256: Schema.String,
  model: Schema.String,
  kept_at: Schema.String,
  expires_at: Schema.NullOr(Schema.String),
  expired_at: Schema.NullOr(Schema.String),
  content_removed: Schema.Boolean,
  address: Schema.NullOr(Schema.String),
  address_until: Schema.NullOr(Schema.String),
});

const readOf = Schema.decodeUnknownSync(ReadSchema);

function assetAt(server: GenerationServer, playbook: string, id: string) {
  return server.call('GET', `/v1/orgs/acme/playbooks/${playbook}/assets/${id}`);
}

const EventsSchema = Schema.Struct({
  events: Schema.Array(Schema.Struct({ type: Schema.String, summary: Schema.String })),
});

const eventsOf = Schema.decodeUnknownSync(EventsSchema);

function aLedger(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

async function withAFunction(gateway: GatewayOnTheLoopback, ledger: TemporaryLedger, source: string) {
  const server = await servingGeneration(gateway, ledger);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const saved = await server.call('POST', `${alpha}/definitions/generation`, {
    body: { name: 'made', source, diagram: 'none' },
  });
  return { server, saved };
}

function made(server: GenerationServer, input: unknown, runId: string) {
  return server.call('POST', `${alpha}/definitions/generation/made/run`, { body: { input, run_id: runId } });
}

interface Read {
  readonly status: number;
  readonly type: string | null;
  readonly bytes: readonly number[];
}

async function bytesAt(address: string): Promise<Read> {
  const answered = await fetch(address);
  return {
    status: answered.status,
    type: answered.headers.get('content-type'),
    bytes: [...new Uint8Array(await answered.arrayBuffer())],
  };
}

interface PartRead {
  readonly status: number;
  readonly range: string | null;
  readonly length: string | null;
  readonly accepts: string | null;
  readonly bytes: readonly number[];
}

async function partAt(address: string, range: string, method = 'GET'): Promise<PartRead> {
  const answered = await fetch(address, { method, headers: { range } });
  return {
    status: answered.status,
    range: answered.headers.get('content-range'),
    length: answered.headers.get('content-length'),
    accepts: answered.headers.get('accept-ranges'),
    bytes: [...new Uint8Array(await answered.arrayBuffer())],
  };
}

function holdsAnExpiry({ events }: typeof EventsSchema.Type): boolean {
  return events.length > 0;
}

const [productPicture] = blocksInOrderOf('reference/generation-format.md').map(({ body }) => body);

const productPictureAt = `${alpha}/definitions/generation/product-picture`;

const decodeRun = Schema.decodeUnknownSync(
  Schema.Struct({ status: Schema.String, page: Schema.Struct({ result: Schema.String }) }),
);

const decodeRuns = Schema.decodeUnknownSync(Schema.Struct({ page: Schema.Struct({ runs: Schema.String }) }));

const flight = [
  '---',
  'produces: video',
  'model: gateway/example/short-film',
  'parameters: { size: 720x1280, duration: 8 }',
  '---',
  'A drone flight over the warehouse.',
].join('\n');

const filming = `do:
  - film: { call: run_definition, with: { type: generation, name: flight } }
`;

const RunsSchema = Schema.Struct({
  runs: Schema.Array(Schema.Struct({ run_id: Schema.String, status: Schema.String })),
});

const decodeRunsGenerationWorkflows = Schema.decodeUnknownSync(RunsSchema);

const decodeHandle = Schema.decodeUnknownSync(
  Schema.Struct({ record: Schema.optional(Schema.NullOr(Schema.Struct({ handle: Schema.optional(Schema.String) }))) }),
);

interface Filming {
  readonly server: ReasoningServer;
  readonly clock: SteppedServerClock;
  readonly startedAt: number;
  readonly workflow: string;
  readonly generation: () => Promise<string>;
}

async function filmed(gateway: GatewayOnTheLoopback, environment: Readonly<Record<string, string>> = {}) {
  const startedAt = testServersStartAt;
  const clock = steppedServerClock(startedAt);
  const server = await servingReasoning([], { MODEL_GATEWAYS: gateway.gateways, ...environment }, undefined, {
    clock,
    shippedFilesOver: shippedWithAFilm,
  });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/generation`, {
    body: { name: 'flight', source: flight, diagram: 'none' },
  });
  await server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'filming', source: workflowSource('filming', filming) },
  });
  const started = await server.call('POST', `${alpha}/definitions/workflow/filming/run`, { body: { input: {} } });
  const generation = async () => {
    const [run] = await whenHeld(
      async () =>
        decodeRunsGenerationWorkflows((await server.call('GET', `${alpha}/runs?type=generation&name=flight`)).body)
          .runs,
      (runs) => runs.length > 0,
    );
    const id = String(run?.run_id);
    await whenHeld(
      async () => decodeHandle((await server.call('GET', `${alpha}/runs/${id}`)).body).record?.handle,
      (handle) => handle !== undefined,
    );
    return id;
  };
  const madeGenerationWorkflows: Filming = { server, clock, startedAt, workflow: runIdIn(started.body), generation };
  return madeGenerationWorkflows;
}

function polledIn(gateway: GatewayOnTheLoopback, polls: number): Promise<unknown> {
  return whenHeld(
    () => Promise.resolve(gateway.asked().filter(({ path }) => path === `/v1/videos/${askedHandle}`).length),
    (asked) => asked >= polls,
  );
}

describe('a generation function over HTTP', () => {
  it('is saved, run against the gateway, and its image read at the address the run answers, without a key', async () => {
    const gateway = await gatewayOnTheLoopback();
    const { server, saved } = await withAFunction(gateway, aLedger(), picture);
    onTestFinished(server.stop);

    const run = runOf((await made(server, { product: 'a teapot' }, '019a4f2e-5c1b-7d3a-8e6f-000000000001')).body);
    const read = await bytesAt(run.output.address);

    expect(saved).toMatchObject({
      status: 201,
      body: { type: 'generation', name: 'made', details: { shape: 'asset' } },
    });
    expect([
      run.output.media_type,
      run.output.bytes,
      run.output.address.startsWith(`${server.origin}${alpha}/content/`),
    ]).toEqual(['image/png', onePixelPng.byteLength, true]);
    expect(run.record).toEqual({ model: 'gateway/openai/gpt-image-2', own_key: true, cost_usd: 0.04 });
    expect(read).toEqual({ status: 200, type: 'image/png', bytes: [...onePixelPng] });
    expect(gateway.asked()).toEqual([
      {
        path: '/v1/images/generations',
        authorization: 'Bearer gateway-test-key',
        body: {
          model: 'openai/gpt-image-2',
          prompt: 'A studio photograph of a teapot on a white table.',
          n: 1,
          size: '1024x1024',
          quality: 'high',
        },
      },
    ]);
  });

  it('speaks a prompt as audio, kept with the cost the gateway answered', async () => {
    const gateway = await gatewayOnTheLoopback();
    const { server } = await withAFunction(gateway, aLedger(), welcome);
    onTestFinished(server.stop);

    const run = runOf((await made(server, {}, '019a4f2e-5c1b-7d3a-8e6f-000000000002')).body);

    expect([run.output.media_type, run.record.cost_usd]).toEqual(['audio/mpeg', 0.002]);
    expect(await bytesAt(run.output.address)).toEqual({ status: 200, type: 'audio/mpeg', bytes: [...spokenBytes] });
  });
});

describe('the audio of a generation function at its address', () => {
  it('answers a player the range of the audio it asks for, and a HEAD that asks a range with the headers of the whole', async () => {
    const gateway = await gatewayOnTheLoopback();
    const { server } = await withAFunction(gateway, aLedger(), welcome);
    onTestFinished(server.stop);
    const run = runOf((await made(server, {}, '019a4f2e-5c1b-7d3a-8e6f-000000000006')).body);
    const size = spokenBytes.byteLength;
    const last = String(size - 1);

    const parts = [
      await partAt(run.output.address, 'bytes=0-'),
      await partAt(run.output.address, 'bytes=1-2'),
      await partAt(run.output.address, 'bytes=1-2', 'HEAD'),
    ];
    const refused = await partAt(run.output.address, `bytes=${String(size)}-`);

    expect(parts).toEqual([
      {
        status: 206,
        range: `bytes 0-${last}/${String(size)}`,
        length: String(size),
        accepts: 'bytes',
        bytes: [...spokenBytes],
      },
      {
        status: 206,
        range: `bytes 1-2/${String(size)}`,
        length: '2',
        accepts: 'bytes',
        bytes: [...spokenBytes.subarray(1, 3)],
      },
      { status: 200, range: null, length: String(size), accepts: 'bytes', bytes: [] },
    ]);
    expect([refused.status, refused.range, refused.accepts]).toEqual([416, `bytes */${String(size)}`, 'bytes']);
  });
});

describe('an asset read again by its id', () => {
  it('answers what the playbook keeps of it and the lasting address the run answered, which answers its bytes without a key', async () => {
    const gateway = await gatewayOnTheLoopback();
    const { server } = await withAFunction(gateway, aLedger(), picture);
    onTestFinished(server.stop);
    const run = runOf((await made(server, { product: 'a teapot' }, '019a4f2e-5c1b-7d3a-8e6f-000000000004')).body);

    const answered = await assetAt(server, 'alpha', run.output.id);
    const read = readOf(answered.body);

    expect(answered.status).toBe(200);
    expect(read).toMatchObject({
      id: run.output.id,
      media_type: 'image/png',
      bytes: onePixelPng.byteLength,
      sha256: run.output.sha256,
      model: 'gateway/openai/gpt-image-2',
      expires_at: null,
      expired_at: null,
      content_removed: false,
      address: run.output.address,
      address_until: null,
    });
    expect(await bytesAt(String(read.address))).toEqual({ status: 200, type: 'image/png', bytes: [...onePixelPng] });
  });

  it('answers not_found where another playbook of the org asks for it', async () => {
    const { server } = await withAFunction(await gatewayOnTheLoopback(), aLedger(), picture);
    onTestFinished(server.stop);
    const run = runOf((await made(server, { product: 'a teapot' }, '019a4f2e-5c1b-7d3a-8e6f-000000000005')).body);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'beta', name: 'Beta' } });

    expect(await assetAt(server, 'beta', run.output.id)).toMatchObject({
      status: 404,
      body: { reason: 'not_found', detail: 'There is no such asset in this playbook' },
    });
  });
});

describe('an asset past its time', () => {
  it('expires as the server finds it due, its expiry in the feed and its read, and its content, kept again within the hour before, still read at the address the run answered', async () => {
    const gateway = await gatewayOnTheLoopback();
    const ledger = aLedger();
    const { server: first } = await withAFunction(gateway, ledger, picture);
    const run = runOf((await made(first, { product: 'a teapot' }, '019a4f2e-5c1b-7d3a-8e6f-000000000003')).body);
    await first.stop();
    await onTheLedgerIn(ledger.fileName, (connection) =>
      connection.write(everyRowSet(projectedTableOf(assets), { expires_at: testServersStartAt - 1000 })),
    );

    const second = await servingGeneration(gateway, ledger);
    onTestFinished(second.stop);
    const { pathname, search } = new URL(run.output.address);
    const feed = await whenHeld(
      async () => eventsOf((await second.call('GET', `${alpha}/events?type=asset_expired`)).body),
      holdsAnExpiry,
    );

    expect((await bytesAt(`${second.origin}${pathname}${search}`)).status).toBe(200);
    const expired = readOf((await assetAt(second, 'alpha', run.output.id)).body);
    expect([
      expired.expires_at,
      typeof expired.expired_at,
      expired.content_removed,
      expired.address,
      expired.address_until,
    ]).toEqual([null, 'string', false, null, null]);
    expect(feed.events).toEqual([
      {
        type: 'asset_expired',
        summary: `An asset of ${onePixelPng.byteLength} bytes expired.`,
      },
    ]);
  });
});

describe('the example of the generation function format, through the server', () => {
  it('is saved with its page, links the picture each run made with its size, and draws the pictures of each day', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const server = await servingGeneration(await gatewayOnTheLoopback(), ledger);
    onTestFinished(server.stop);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const saved = await server.call('POST', `${alpha}/definitions/generation`, {
      body: { name: 'product-picture', source: productPicture, diagram: 'none' },
    });
    const ran = await server.call('POST', `${productPictureAt}/run`, { body: { input: { product: 'a teapot' } } });
    const run = await server.call('GET', `${alpha}/runs/${runIdIn(ran.body)}`);
    const definition = await whenHeld(
      async () => (await server.call('GET', productPictureAt)).body,
      (body) => JSON.stringify(body).includes('"folded":1'),
    );

    expect(saved.status).toBe(201);
    expect(decodeRun(run.body).status).toBe('succeeded');
    expect(decodeRun(run.body).page.result).toMatch(
      /^\[A picture of the product for its listing\]\(http[^)]+\/content\/[^)]+\), 0 MB\.$/u,
    );
    expect(decodeRuns(definition).page.runs).toMatch(
      /^```chart line\n\{"unit":"pictures","period":"day","lines":\[\{"name":"Pictures","points":\[\{"at":"\d{4}-\d{2}-\d{2}","value":1\}\]\}\]\}\n```$/u,
    );
  });
});

describe('a workflow step that runs a generation function whose video finishes later', () => {
  it('waits while the provider makes the video, as a step that waits on an interaction does, and goes on with the asset once it is kept', async () => {
    const gateway = await gatewayOnTheLoopback();
    const { server, clock, startedAt, workflow, generation } = await filmed(gateway);
    const run = await generation();
    const waiting = [
      (await server.call('GET', `${alpha}/runs/${workflow}`)).body,
      (await server.call('GET', `${alpha}/runs/${run}`)).body,
    ];

    clock.moveTo(startedAt + 120_000);
    await polledIn(gateway, 1);
    clock.moveTo(startedAt + 240_000);
    const ended = (await settledAsSwept(server, clock, `${alpha}/runs/${workflow}`)).body;

    expect(waiting).toMatchObject([{ status: 'started' }, { status: 'started', record: { handle: askedHandle } }]);
    expect(ended).toMatchObject({
      status: 'succeeded',
      output: { media_type: 'video/mp4', bytes: filmedBytes.byteLength },
    });
    expect((await server.call('GET', `${alpha}/runs/${run}`)).body).toMatchObject({
      status: 'succeeded',
      record: { model: 'gateway/example/short-film', own_key: true, cost_usd: 0.8 },
    });
    expect(gateway.asked().map(({ path }) => path)).toEqual([
      '/v1/videos',
      `/v1/videos/${askedHandle}`,
      `/v1/videos/${askedHandle}`,
      `/v1/videos/${askedHandle}/content`,
    ]);
  });
});

describe('a workflow step that runs a generation function whose video is not made in time', () => {
  it('ends the step unavailable once the video is not made within the time a run waits for it', async () => {
    const gateway = await gatewayOnTheLoopback([{ id: askedHandle, status: 'in_progress', progress: 1 }]);
    const { server, clock, startedAt, workflow, generation } = await filmed(gateway, { GENERATION_WAIT_MINUTES: '1' });
    const run = await generation();

    clock.moveTo(startedAt + 30_000);
    await polledIn(gateway, 1);
    clock.moveTo(startedAt + 150_000);
    const ended = (await settledAsSwept(server, clock, `${alpha}/runs/${workflow}`)).body;

    expect(ended).toMatchObject({ status: 'rejected', rejection: { reason: 'unavailable' } });
    expect((await server.call('GET', `${alpha}/runs/${run}`)).body).toMatchObject({
      status: 'rejected',
      rejection: {
        reason: 'unavailable',
        kind: 'generation_timed_out',
        detail:
          'The provider behind the gateway gateway had not made the video when the run had waited 1 minute for it, as long as a run waits; a new run asks for it again',
      },
    });
    expect(gateway.asked().some(({ path }) => path.endsWith('/content'))).toBe(false);
  });
});
