import { withMcpSession, type McpSession, type ToolResult } from '@on.auto/api/testing';
import { Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { temporaryLedger } from '../records/temporary-ledger.ts';
import { gatewayOnTheLoopback, servingGeneration, type GenerationServer } from './generation-server.ts';
import { alpha } from './reasoning-server.ts';

const pictureOfAProduct = [
  '---',
  'description: A picture of the product for its listing',
  'produces: image',
  'model: gateway/openai/gpt-image-2',
  'parameters: { size: 1024x1024 }',
  '---',
  'A studio photograph of {{ input.product }}.',
].join('\n');

export async function servingAPicture(): Promise<GenerationServer> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const server = await servingGeneration(await gatewayOnTheLoopback(), ledger);
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/generation`, {
    body: { name: 'picture', source: pictureOfAProduct, diagram: 'none' },
  });
  return server;
}

export function onAlphaOf<T>(server: GenerationServer, use: (session: McpSession) => Promise<T>): Promise<T> {
  return withMcpSession(
    'current revision',
    { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: {} },
    use,
  );
}

const assetIdIn = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Struct({ id: Schema.String }) }));

export function assetMadeBy({ structuredContent }: ToolResult): string {
  return assetIdIn(structuredContent).output.id;
}
