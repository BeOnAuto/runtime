import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeProviderOffering } from '../index.ts';
import { issuesIn } from '../testing/additions.ts';
import { adminsAlone, startedByAdminsOf, startsNotSaid } from '../testing/connection-starts.ts';
import { ada, connectionServicesWith, grace, operationNamed } from '../testing/harness.ts';
import { replacingFiles, replacingPolicy } from '../testing/replacements.ts';

const replacedHere = 'The provider files is replaced here by messages, which a connection is added from instead';

describe('a provider another provider of the list replaces', () => {
  it('is listed with no way offered, saying which provider replaces it, beside the one that replaces it, which names it', async () => {
    const { h, after } = replacingFiles();

    const listed = await h.call(operationNamed(after, 'list_providers'), ada);

    expect(listed).toMatchObject({
      output: {
        providers: [
          { name: 'files', credentials: [{ kind: 'authorization', offered: false, because: replacedHere }] },
          { name: 'messages', replaces: ['files'], credentials: [{ offered: true, client_source: 'gateway' }] },
        ],
      },
    });
  });

  it('is left out of the providers a person may connect, which search offers', async () => {
    const { h, providers } = replacingFiles();
    const services = connectionServicesWith({ providers, policy: replacingPolicy, consent: h.consent });

    const offered = await Effect.runPromise(makeProviderOffering(services)(ada));

    expect(offered?.map(({ name }) => name)).toEqual(['messages']);
  });

  it('is not added from: the addition is refused at the provider, naming the one that replaces it, and records nothing', async () => {
    const { h, after } = replacingFiles();

    const outcome = await h.call(operationNamed(after, 'add_connection'), ada, { provider: 'files' });

    expect(issuesIn(outcome)).toEqual([{ pointer: '/provider', detail: replacedHere }]);
    expect(await h.facts()).toEqual([]);
  });
});

describe('the provider that replaces another, as list_providers answers it to each caller', () => {
  it('tells, where only an admin connects it, an admin they may reconnect the connections made from the one it replaces, and anyone else why not', async () => {
    const { h, providers } = replacingFiles();
    const listing = operationNamed(
      h.operationsWith({ providers, starts: startedByAdminsOf('messages', [grace.id]).starts }),
      'list_providers',
    );

    const [byAnAdmin, byAnother] = await Promise.all([h.call(listing, grace), h.call(listing, ada)]);

    expect(byAnAdmin).toMatchObject({ output: { providers: [{ name: 'files' }, { may_reconnect: true }] } });
    expect(JSON.stringify(byAnAdmin)).not.toContain('reconnect_refusal');
    expect(byAnother).toMatchObject({
      output: { providers: [{ name: 'files' }, { may_reconnect: false, reconnect_refusal: adminsAlone }] },
    });
  });

  it('says nothing of who reconnects where whoever added a connection reconnects it, or where the host cannot say just now', async () => {
    const { h, providers } = replacingFiles();
    const listedBy = async (starts: Parameters<typeof h.operationsWith>[0]['starts']) => {
      const outcome = await h.call(operationNamed(h.operationsWith({ providers, starts }), 'list_providers'), ada);
      return JSON.stringify(outcome);
    };

    const listings = await Promise.all([listedBy(startedByAdminsOf('drive', []).starts), listedBy(startsNotSaid)]);

    expect(listings.filter((listed) => listed.includes('may_reconnect'))).toEqual([]);
  });
});
