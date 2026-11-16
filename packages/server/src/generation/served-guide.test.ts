import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import {
  gatewayOnTheLoopback,
  servingGeneration,
  type GatewayOnTheLoopback,
  type GenerationServer,
} from '../testing/servers/generation-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

const exampleFence = /^(`{3,4})markdown\n([\s\S]*?)^\1$/gmu;

const examplesNamed = ['product-picture', 'welcome', 'restyled'];

const changedOnlyByWhoeverRunsIt =
  "The limits for one image, one asset of audio, a playbook's assets and how long an asset is kept without `expires` can be changed only by whoever runs the server.";

const decodeRun = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }));

const settingsOfAnOperator = {
  GENERATION_MAX_IMAGE_MIB: '3',
  GENERATION_MAX_AUDIO_MIB: '7',
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
    expect(serving.guide).toContain("| The storage quota of a playbook's assets | 11 MiB |");
    expect(serving.guide).toContain('| How long an asset is kept without `expires` | 13 days |');
    expect(serving.guide).toContain('Without it, an asset is kept for 13 days |');
    expect(serving.guide).toContain(changedOnlyByWhoeverRunsIt);
    expect(serving.guide).toContain('such as `images/openai/gpt-image-2` for `openai/gpt-image-2`.');
    expect(serving.guide).not.toMatch(/20 MiB|50 MiB|2,048 MiB|90 days|gateway\/openai|data-audience|data-variable/u);
    expect(serving.examples.map((example) => /^model: (.*)$/mu.exec(example)?.[1])).toEqual([
      'images/openai/gpt-image-2',
      'images/openai/gpt-4o-mini-tts',
      'images/openai/gpt-image-2',
    ]);
    expect(saved.map(({ status }) => status)).toEqual([201, 201, 201]);
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
      '<gateway>/openai/gpt-4o-mini-tts',
      '<gateway>/openai/gpt-image-2',
    ]);
    expect(saved).toEqual(Array.from({ length: 3 }, () => ({ status: 422, refusedAtTheModel: true })));
  });
});
