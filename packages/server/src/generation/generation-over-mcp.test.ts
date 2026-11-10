import { plainTextIn, problemIn, withMcpSession, type McpSession } from '@on.auto/api/testing';
import { onePixelPng } from '@on.auto/generation/testing';
import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { assetMadeBy, onAlphaOf, servingAPicture } from '../testing/servers/asset-calls.ts';
import {
  gatewayOnTheLoopback,
  servingGeneration,
  type GenerationServer,
} from '../testing/servers/generation-server.ts';

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
  it('is read again by its id, with an address signed as it is read, in plain words that name no internal term', async () => {
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
    expect(plainTextIn(read)).toContain('its address, in the details below, opens it for 15 minutes.');
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
              "Line 4, /model: openai/gpt-9-image is no model of the catalogue of generation models; the catalogue's models that produce image are openai/gpt-image-2 or openai/gpt-image-2.6-flare",
          },
        ],
      },
    });
  });
});
