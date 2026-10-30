import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readModelSettings } from './model-settings.ts';
import type { SettingProblem } from './setting-values.ts';

async function problemsOf(aliases: Readonly<Record<string, string>>): Promise<readonly SettingProblem[]> {
  const error = await Effect.runPromise(Effect.flip(readModelSettings({ MODEL_ALIASES: JSON.stringify(aliases) })));
  return error.problems;
}

function aliasProblem(alias: string, detail: string): SettingProblem {
  return { setting: 'MODEL_ALIASES', pointer: `/${alias.replaceAll('/', '~1')}`, detail };
}

const misplaced = 'A * stands once, at the end of both an alias and its target';
const oneHop = 'The target is itself an alias; an alias resolves in one hop';

describe('a wildcard alias in MODEL_ALIASES', () => {
  it('is read with a trailing * on both sides', async () => {
    const aliases = {
      'anthropic/*': 'gateway/anthropic/*',
      'openai/gpt-*': 'gateway/*',
      'house/fast': 'gateway/llama-3.3-70b',
    };

    const settings = await Effect.runPromise(readModelSettings({ MODEL_ALIASES: JSON.stringify(aliases) }));

    expect(settings.aliases).toEqual(new Map(Object.entries(aliases)));
  });

  it('is rejected when a * stands anywhere but once at the end of both sides', async () => {
    const aliases = {
      'anthropic/*': 'gateway/anthropic/model',
      'openai/gpt-5': 'gateway/*',
      'google/*/x': 'gateway/google/*/x',
      'mistral/**': 'gateway/mistral/**',
      'meta/*': 'gateway/*/meta/*',
    };

    expect(await problemsOf(aliases)).toEqual(Object.keys(aliases).map((alias) => aliasProblem(alias, misplaced)));
  });

  it('is rejected when a side is not provider/ followed by the *', async () => {
    expect(await problemsOf({ '*': 'gateway/*', 'anthropic*': 'gateway/*' })).toEqual([
      { setting: 'MODEL_ALIASES', pointer: '/*', detail: 'An alias and its target are each written provider/model' },
      aliasProblem('anthropic*', 'An alias and its target are each written provider/model'),
    ]);
  });

  it('is rejected when its target could resolve again through another alias', async () => {
    const aliases = {
      'anthropic/*': 'gateway/*',
      'gateway/fast': 'local/llama',
      'openai/*': 'relay/openai/*',
      'relay/*': 'local/*',
      'google/*': 'mirror/*',
      'mirror/google/*': 'local/google/*',
      'house/smart': 'proxy/x',
      'proxy/*': 'local/proxy/*',
    };

    expect(await problemsOf(aliases)).toEqual(
      ['anthropic/*', 'openai/*', 'google/*', 'house/smart'].map((alias) => aliasProblem(alias, oneHop)),
    );
  });
});
