import { assets } from '@on.auto/generation';
import { onePixelPng, spokenBytes } from '@on.auto/generation/testing';
import { projectedTableOf } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { everyRowSet, onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import {
  gatewayOnTheLoopback,
  servingGeneration,
  type GatewayOnTheLoopback,
  type GenerationServer,
} from '../testing/servers/generation-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { until } from '../testing/waiting/until.ts';

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
    address_until: Schema.String,
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
  it('answers what the playbook keeps of it and an address signed as it is read, which answers its bytes without a key', async () => {
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
      expired_at: null,
      content_removed: false,
    });
    expect(Date.parse(String(read.address_until))).toBeGreaterThanOrEqual(Date.parse(run.output.address_until));
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
  it('expires as the server finds it due, its expiry in the feed and its read, and its content, kept again within the hour before, read at its address until the address ends', async () => {
    const gateway = await gatewayOnTheLoopback();
    const ledger = aLedger();
    const { server: first } = await withAFunction(gateway, ledger, picture);
    const run = runOf((await made(first, { product: 'a teapot' }, '019a4f2e-5c1b-7d3a-8e6f-000000000003')).body);
    await first.stop();
    await onTheLedgerIn(ledger.fileName, (connection) =>
      connection.write(everyRowSet(projectedTableOf(assets), { expires_at: Date.now() - 1000 })),
    );

    const second = await servingGeneration(gateway, ledger);
    onTestFinished(second.stop);
    const { pathname, search } = new URL(run.output.address);
    const feed = await until(
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
