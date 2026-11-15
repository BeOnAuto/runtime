import { fixtureProviders, providerListOf, providerOf, tracker } from '@on.auto/providers/testing';
import { readToolServerSettings } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeProviderResolver } from './provider-resolver.ts';

const issues = providerOf({ ...tracker, name: 'issues', aliases: ['tracker'] });

function serversNaming(provider: string) {
  const named = { provider, placeholders: { site: 'acme' }, credential: '${TRACKER_TOKEN}', org: 'acme' };
  return Effect.runSync(
    readToolServerSettings(
      { TRACKER_TOKEN: 'tracker-token-5e8a1f0c', TOOL_SERVERS: JSON.stringify({ named }) },
      { modelProviders: ['openai'], providers: makeProviderResolver(providerListOf(issues)) },
    ),
  ).servers;
}

describe('a provider the settings file names by another name its entry declares', () => {
  it('is the provider of that entry, its server served under the name it has now', () => {
    expect(serversNaming('tracker')).toMatchObject([
      { name: 'named', provider: 'issues', url: 'https://acme.tracker.example.com/mcp' },
    ]);
  });

  it('is served as before where the file names it by its own name', () => {
    const named = { provider: 'tracker', placeholders: { site: 'acme' }, credential: '${TRACKER_TOKEN}', org: 'acme' };
    const servers = Effect.runSync(
      readToolServerSettings(
        { TRACKER_TOKEN: 'tracker-token-5e8a1f0c', TOOL_SERVERS: JSON.stringify({ named }) },
        { modelProviders: ['openai'], providers: makeProviderResolver(fixtureProviders) },
      ),
    ).servers;

    expect(servers).toMatchObject([
      { name: 'named', provider: 'tracker', url: 'https://acme.tracker.example.com/mcp' },
    ]);
  });
});
