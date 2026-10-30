import type { Environment } from '@on.auto/config';

import { configuredProviders } from '../settings/configured-providers.ts';

const noModelYet = 'none configured; copy .env.example to .env and put a key in it';

function modelsIn(settings: Environment): string {
  const configured = configuredProviders(settings);
  return configured.length === 0 ? noModelYet : configured.join(', ');
}

export function readyNotice(port: number, settings: Environment): string {
  return [
    'Auto Runtime is ready',
    `  server     http://localhost:${port}`,
    `  models     ${modelsIn(settings)}`,
    `  MCP        http://localhost:${port}/mcp`,
  ].join('\n');
}
