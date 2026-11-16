import { servedForConsent } from '@on.auto/tool-servers/served-fakes';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  connectedByConsent,
  consentFinishedBy,
  consentStartedFrom,
  filesProvidedBy,
  linkAddedBy,
  servedStudioReturn,
  type GroupOfMore,
} from '../testing/servers/consents-over-http.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const connections = '/v1/orgs/local/connections';

const sharing: GroupOfMore = {
  name: 'share',
  for: 'Share your files with other people.',
  scope: 'files.share',
  says: { 'files.share': 'Share the files of the account with other people.' },
};

const offeredGroup = { name: sharing.name, for: sharing.for };

const filesOffered: unknown = expect.arrayContaining([
  { name: 'files', title: 'Files', description: 'Read the files of an account.', more: [offeredGroup] },
]);

async function servedWithTheGroup(): Promise<ReasoningServer> {
  const { port, returnAddress } = await servedStudioReturn();
  const fake = await servedForConsent({ redirectUris: [returnAddress] });
  const served = await servingReasoning([], { PORT: String(port), ...filesProvidedBy(fake, [sharing]) });
  onTestFinished(async () => {
    await served.stop();
    await fake.close();
  });
  return served;
}

describe('a connection connected by consent, to a provider whose way names a group of more', () => {
  it('is offered the group by the search and by its record, and is granted the scopes of both consents once the person allows it', async () => {
    const served = await servedWithTheGroup();

    const searched = await served.call('GET', '/v1/orgs/local/tool-servers/search');
    const id = await connectedByConsent(served);
    const connected = await served.call('GET', `${connections}/${id}`);
    const link = linkAddedBy(await served.call('POST', `${connections}/${id}/link`, { body: { more: sharing.name } }));
    const started = await consentStartedFrom(served, link);
    await consentFinishedBy(served, link, started.authorize.href);
    const allowed = await served.call('GET', `${connections}/${id}`);
    const askedAgain = await served.call('POST', `${connections}/${id}/link`, { body: { more: sharing.name } });

    expect(searched).toMatchObject({ status: 200, body: { providers: filesOffered } });
    expect(connected).toMatchObject({
      status: 200,
      body: { status: 'connected', granted_scope: 'files.read', more: [offeredGroup] },
    });
    expect(started.authorize.searchParams.get('scope')).toBe('files.read files.share');
    expect(allowed).toMatchObject({
      status: 200,
      body: {
        status: 'connected',
        granted_scope: 'files.read files.share',
        asked_scopes: [
          { name: 'files.read', says: 'Read the files of the account.' },
          { name: 'files.share', says: sharing.says['files.share'] },
        ],
        more: [],
      },
    });
    expect(askedAgain).toMatchObject({ status: 409, body: { reason: 'conflict' } });
  });
});
