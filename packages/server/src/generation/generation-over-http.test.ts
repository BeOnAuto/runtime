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
  'model: gateway/openai/gpt-image-1',
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
    expect(run.record).toEqual({ model: 'gateway/openai/gpt-image-1', own_key: true, cost_usd: 0.04 });
    expect(read).toEqual({ status: 200, type: 'image/png', bytes: [...onePixelPng] });
    expect(gateway.asked()).toEqual([
      {
        path: '/v1/images/generations',
        authorization: 'Bearer gateway-test-key',
        body: {
          model: 'openai/gpt-image-1',
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

describe('an asset past its time', () => {
  it('expires as the server finds it due, its expiry in the feed, its content kept and read at its address until the address ends', async () => {
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
    expect(feed.events).toEqual([
      {
        type: 'asset_expired',
        summary: `An asset of ${onePixelPng.byteLength} bytes expired, and its content was kept.`,
      },
    ]);
  });
});
