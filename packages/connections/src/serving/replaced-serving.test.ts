import { describe, expect, it } from 'vitest';

import { added } from '../testing/additions.ts';
import { connectedFiles, replacingFiles, replacingPolicy } from '../testing/replacements.ts';
import { servedAs, sourceOver } from '../testing/served-connections.ts';

function replacedWords(name: string): string {
  return `The connection ${name} was added from the provider files, which messages replaces here, so no playbook may use it until it is reconnected, which adds it again from messages under the same name`;
}

describe('a connection whose provider another provider replaces', () => {
  it('is served to no playbook, whether connected or not yet connected, as one to reconnect, saying how it is used again, and nothing records it broken', async () => {
    const replacing = await replacingFiles();
    const connected = await connectedFiles(replacing);
    const pending = await added(replacing.h, { provider: 'files', name: 'files-two' });
    const source = sourceOver(replacing.h, { providers: replacing.providers, policy: replacingPolicy });
    const recorded = await replacing.h.facts();

    expect((await servedAs(source, connected.id)).state).toEqual({
      status: 'unready',
      unready: { because: 'connection_broken', detail: replacedWords('files') },
    });
    expect((await servedAs(source, pending.id)).state).toEqual({
      status: 'unready',
      unready: { because: 'connection_broken', detail: replacedWords('files-two') },
    });
    expect(await replacing.h.facts()).toEqual(recorded);
  });
});
