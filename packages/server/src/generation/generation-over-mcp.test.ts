import { type McpSession, plainTextIn, problemIn, withMcpSession } from '@on.auto/api/testing';
import { onePixelPng } from '@on.auto/generation/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { assetMadeBy, onAlphaOf, servingAPicture } from '../testing/servers/asset-calls.ts';
import {
  gatewayOnTheLoopback,
  type GatewayOnTheLoopback,
  type GenerationServer,
  servingGeneration,
} from '../testing/servers/generation-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const picture = [
  '---',
  'description: A picture of the product for its listing',
  'produces: image',
  'model: gateway/openai/gpt-image-2',
  'parameters: { size: 1024x1024 }',
  '---',
  'A studio photograph of {{ input.product }}.',
].join('\n');

async function onAlpha<T>(
  use: (session: McpSession) => Promise<T>,
): Promise<{ readonly server: GenerationServer; readonly used: T }> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const server = await servingGeneration(await gatewayOnTheLoopback(), ledger);
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const used = await withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
  return { server, used };
}

const exampleFence = /^(`{3,4})markdown\n([\s\S]*?)^\1$/gmu;

const examplesNamed = ['product-picture', 'welcome', 'film', 'restyled'];

const changedOnlyByWhoeverRunsIt =
  "The limits for one image, one asset of audio, one video, a playbook's assets and how long an asset is kept without `expires` can be changed only by whoever runs the server.";

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }));

const settingsOfAnOperator = {
  GENERATION_MAX_IMAGE_MIB: '3',
  GENERATION_MAX_AUDIO_MIB: '7',
  GENERATION_MAX_VIDEO_MIB: '17',
  ASSET_STORAGE_QUOTA_MIB: '11',
  ASSET_RETENTION_DAYS: '13',
};

function examplesIn(guide: string): readonly string[] {
  const examples: string[] = [];
  for (const [, , body] of guide.matchAll(exampleFence)) {
    examples.push(String(body));
  }
  return examples;
}

interface Served {
  readonly server: GenerationServer;
  readonly guide: string;
  readonly examples: readonly string[];
}

async function served(
  gateway?: GatewayOnTheLoopback,
  settings: Readonly<Record<string, string>> = {},
): Promise<Served> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const server = await servingGeneration(gateway, ledger, settings);
  onTestFinished(server.stop);
  const guide = await (await fetch(`${server.origin}/v1/guides/generation-function`)).text();
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return { server, guide, examples: examplesIn(guide) };
}

interface Saved {
  readonly status: number;
  readonly refusedAtTheModel: boolean;
}

function savedIn({ server, examples }: Served): Promise<readonly Saved[]> {
  return examples.reduce<Promise<readonly Saved[]>>(async (earlier, source, index) => {
    const saved = await earlier;
    const answered = await server.call('POST', `${alpha}/definitions/generation`, {
      body: { name: examplesNamed[index], source, diagram: 'none' },
    });
    return [
      ...saved,
      {
        status: answered.status,
        refusedAtTheModel: answered.text.includes('/model: A model is written gateway/model'),
      },
    ];
  }, Promise.resolve([]));
}

describe('a generation function over MCP, on the endpoint of its playbook', () => {
  it('is created and run, answering the asset it made in plain words that name no internal term', async () => {
    const { used } = await onAlpha(async (session) => {
      const created = await session.callTool('create_definition', {
        type: 'generation',
        name: 'picture',
        source: picture,
        diagram: 'none',
      });
      const ran = await session.callTool('run_definition', {
        type: 'generation',
        name: 'picture',
        input: { product: 'a teapot' },
      });
      return { created, ran };
    });

    expect(used.created.structuredContent).toMatchObject({ type: 'generation', name: 'picture', version: 1 });
    expect(used.ran.structuredContent).toMatchObject({
      status: 'succeeded',
      output_shape: 'asset',
      output: { media_type: 'image/png', bytes: onePixelPng.byteLength },
    });
    expect(plainTextIn(used.ran)).toContain(
      `It made an image of ${onePixelPng.byteLength} bytes, kept as an asset of the playbook.`,
    );
    expect(internalTermsIn(plainTextIn(used.ran))).toEqual([]);
  });
});

describe('an asset a generation function made, over MCP', () => {
  it('is read again by its id, with its address, in plain words that name no internal term', async () => {
    const server = await servingAPicture();

    const { ran, read } = await onAlphaOf(server, async (session) => {
      const made = await session.callTool('run_definition', {
        type: 'generation',
        name: 'picture',
        input: { product: 'a teapot' },
      });
      return { ran: made, read: await session.callTool('get_asset', { id: assetMadeBy(made) }) };
    });

    expect(read.structuredContent).toMatchObject({
      id: assetMadeBy(ran),
      media_type: 'image/png',
      bytes: onePixelPng.byteLength,
      model: 'gateway/openai/gpt-image-2',
      content_removed: false,
    });
    expect(
      String(read.structuredContent?.['address']).startsWith(`${server.origin}/v1/orgs/acme/playbooks/alpha/content/`),
    ).toBe(true);
    expect(plainTextIn(read)).toContain('its address, in the details below, opens it');
    expect(internalTermsIn(plainTextIn(read))).toEqual([]);
  });
});

describe('a generation function over MCP that names a model of no catalogue', () => {
  it('is refused as it is saved where its model is no model of the catalogue', async () => {
    const { used } = await onAlpha((session) =>
      session.callTool('create_definition', {
        type: 'generation',
        name: 'picture',
        source: picture.replace('openai/gpt-image-2', 'openai/gpt-9-image'),
        diagram: 'none',
      }),
    );

    expect({ isError: used.isError, problem: problemIn(used) }).toMatchObject({
      isError: true,
      problem: {
        status: 422,
        reason: 'invalid_input',
        errors: [
          {
            detail:
              "Line 4, /model: openai/gpt-9-image is no model of the catalogue of generation models; the catalogue's models that produce image are openai/gpt-image-2, openai/gpt-image-2.6-flare, openai/gpt-image-2.6-sunburst, vertex_ai/gemini-3-pro-image, vertex_ai/gemini-nano-banana-2.1, or xai/grok-imagine-image-2.0",
          },
        ],
      },
    });
  });
});

describe('the guide of generation functions a server serves', () => {
  it('says the bounds its operator set and names its gateway, so each example saves as it is copied, and runs there', async () => {
    const gateway = await gatewayOnTheLoopback(undefined, 'images');
    const serving = await served(gateway, settingsOfAnOperator);

    const saved = await savedIn(serving);
    const ran = await serving.server.call('POST', `${alpha}/definitions/generation/welcome/run`, {
      body: { input: { shop: 'the corner shop' } },
    });

    expect(serving.guide).toContain('| One image | 3 MiB |');
    expect(serving.guide).toContain('| One asset of audio | 7 MiB |');
    expect(serving.guide).toContain('| One video | 17 MiB |');
    expect(serving.guide).toContain("| The storage quota of a playbook's assets | 11 MiB |");
    expect(serving.guide).toContain('| An asset without `expires` | expires after 13 days |');
    expect(serving.guide).toContain('Without it, an asset expires after 13 days |');
    expect(serving.guide).toContain(changedOnlyByWhoeverRunsIt);
    expect(serving.guide).toContain('such as `images/openai/gpt-image-2` for `openai/gpt-image-2`.');
    expect(serving.guide).not.toMatch(/20 MiB|50 MiB|2,048 MiB|90 days|gateway\/openai|data-audience|data-variable/u);
    expect(serving.examples.map((example) => /^model: (.*)$/mu.exec(example)?.[1])).toEqual([
      'images/openai/gpt-image-2',
      'images/vertex_ai/gemini-3.8-flash-tts',
      'images/vertex_ai/veo-3.1-fast-generate-001',
      'images/openai/gpt-image-2',
    ]);
    expect(saved.map(({ status }) => status)).toEqual([201, 201, 201, 201]);
    expect(decodeRun(ran.body).status).toBe('succeeded');
    expect(gateway.asked().map(({ path }) => path)).toEqual(['/v1/audio/speech']);
  });

  it('says the defaults where its operator set none, and leaves the gateway of its examples to fill in where it has none, which a save refuses', async () => {
    const serving = await served();

    const saved = await savedIn(serving);

    expect(serving.guide).toContain('| One image | 20 MiB |');
    expect(serving.guide).toContain("| The storage quota of a playbook's assets | 2,048 MiB |");
    expect(serving.guide).toContain(changedOnlyByWhoeverRunsIt);
    expect(serving.guide).toContain('such as `<gateway>/openai/gpt-image-2` for `openai/gpt-image-2`.');
    expect(serving.examples.map((example) => /^model: (.*)$/mu.exec(example)?.[1])).toEqual([
      '<gateway>/openai/gpt-image-2',
      '<gateway>/vertex_ai/gemini-3.8-flash-tts',
      '<gateway>/vertex_ai/veo-3.1-fast-generate-001',
      '<gateway>/openai/gpt-image-2',
    ]);
    expect(saved).toEqual(Array.from({ length: 4 }, () => ({ status: 422, refusedAtTheModel: true })));
  });
});
