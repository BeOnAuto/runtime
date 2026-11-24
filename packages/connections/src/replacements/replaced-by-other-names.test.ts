import { drive, messages, messagesThrough, providerListOf, providerOf, providersOf } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { added, issuesIn } from '../testing/additions.ts';
import { startedByAdminsOf } from '../testing/connection-starts.ts';
import { filesAt } from '../testing/consents.ts';
import { ada, connectionsManagedBy, grace, harness, operationNamed, recordedAs } from '../testing/harness.ts';
import { pressed } from '../testing/presses.ts';
import { connectedFiles, replacingFiles, replacingPolicy, type Replacing } from '../testing/replacements.ts';
import { servedAs, sourceOver } from '../testing/served-connections.ts';

const namesOfDrive = ['files', 'drive'];

function renamedBeside({ files, gateway }: Pick<Replacing, 'files' | 'gateway'>, replaced: string) {
  return providerListOf(
    providerOf({ ...filesAt(files).entry, name: 'drive', aliases: ['files'] }),
    providerOf({ ...messagesThrough({ url: gateway.url, document: gateway.document }), replaces: [replaced] }),
  );
}

function afterReplacing(replacing: Replacing, replaced: string) {
  return replacing.h.operationsWith({ providers: renamedBeside(replacing, replaced) });
}

const replacedHere = 'The provider drive is replaced here by messages, which a connection is added from instead';

describe('a provider another replaces by a name it had before, which its entry declares as another of its names', () => {
  it('is the provider replaced, listed under its name now, which the one that replaces it names too', async () => {
    const replacing = replacingFiles();

    const listings = await Promise.all(
      namesOfDrive.map((replaced) =>
        replacing.h.call(operationNamed(afterReplacing(replacing, replaced), 'list_providers'), ada),
      ),
    );

    expect(listings).toMatchObject(
      namesOfDrive.map(() => ({
        output: {
          providers: [
            { name: 'drive', credentials: [{ offered: false, because: replacedHere }] },
            { name: 'messages', replaces: ['drive'], credentials: [{ offered: true }] },
          ],
        },
      })),
    );
  });

  it('is not added from by either of its names, refused at the provider under its name now, recording nothing', async () => {
    const replacing = replacingFiles();
    const after = afterReplacing(replacing, 'files');

    const outcomes = await Promise.all(
      namesOfDrive.map((provider) => replacing.h.call(operationNamed(after, 'add_connection'), ada, { provider })),
    );

    expect(outcomes.map((outcome) => issuesIn(outcome))).toEqual(
      namesOfDrive.map(() => [{ pointer: '/provider', detail: replacedHere }]),
    );
    expect(await replacing.h.facts()).toEqual([]);
  });
});

describe('the connections of a provider another replaces by a name it had before', () => {
  it('replaces the connections added under either of its names, which are served to no playbook until reconnected', async () => {
    const replacing = replacingFiles();
    const connected = await connectedFiles(replacing);
    const detail =
      'The connection files was added from the provider drive, which messages replaces here, so no playbook may use it until it is reconnected, which adds it again from messages under the same name';

    const states = await Promise.all(
      namesOfDrive.map(async (replaced) => {
        const providers = renamedBeside(replacing, replaced);
        return (await servedAs(sourceOver(replacing.h, { providers, policy: replacingPolicy }), connected.id)).state;
      }),
    );

    expect(states).toEqual(
      namesOfDrive.map(() => ({ status: 'unready', unready: { because: 'connection_broken', detail } })),
    );
  });

  it('adds such a connection again, reconnected, from the provider that replaces it under the same name', async () => {
    const outcomes = await Promise.all(
      namesOfDrive.map(async (replaced) => {
        const replacing = replacingFiles();
        const connected = await connectedFiles(replacing);
        const after = afterReplacing(replacing, replaced);
        return replacing.h.call(operationNamed(after, 'reconnect_connection'), ada, { id: connected.id });
      }),
    );

    expect(outcomes).toMatchObject(
      namesOfDrive.map(() => ({ status: 'succeeded', output: { name: 'files', provider: 'messages' } })),
    );
  });

  it('does not sign in again a connection added under its name before, through a link still open', async () => {
    const replacing = replacingFiles();
    const { id, token } = await added(replacing.h, { provider: 'files' });

    const outcome = await replacing.h.call(operationNamed(afterReplacing(replacing, 'drive'), 'start'), ada, {
      id,
      token,
    });

    expect(outcome).toMatchObject({
      reason: 'conflict',
      detail:
        'The connection files was added from the provider drive, which messages replaces here, so it is not signed in to again: reconnecting it adds it again from messages under the same name',
    });
  });
});

describe('Connect again, where only an admin connects the provider that replaces one by a name it had before', () => {
  it('is pressed by an admin, the host asked of the provider that replaces it by its name, and adds it again from that one', async () => {
    const replacing = replacingFiles();
    const old = await connectedFiles(replacing);
    const heard = startedByAdminsOf('messages', [grace.id]);
    const ops = replacing.h.operationsWith({ providers: renamedBeside(replacing, 'files'), starts: heard.starts });

    expect(await pressed({ h: replacing.h, ops }, old.id, grace)).toMatchObject({
      status: 'succeeded',
      output: { name: 'files', provider: 'messages', status: 'pending', added_by: recordedAs.grace },
    });
    expect(heard.asked()).toEqual([['messages', grace.id]]);
  });

  it('is offered by list_providers to an admin alone, beside the provider it replaces under its name now, the host asked by the name it is listed under', async () => {
    const asked: string[] = [];
    const host = startedByAdminsOf('messages', []);
    const h = harness({
      providers: providersOf({ ...drive, aliases: ['files'] }, { ...messages, replaces: ['files'] }),
      decidedBy: connectionsManagedBy('grace'),
      startsRuledFor: (provider) => {
        asked.push(provider);
        return true;
      },
      starts: host.starts,
    });
    const listing = operationNamed(h.operations, 'list_providers');

    const listings = await Promise.all([h.call(listing, grace), h.call(listing, ada)]);

    expect(listings).toMatchObject(
      [true, false].map((mayReconnect) => ({
        output: {
          providers: [{ name: 'drive' }, { name: 'messages', replaces: ['drive'], may_reconnect: mayReconnect }],
        },
      })),
    );
    expect([new Set(asked), host.asked()]).toEqual([new Set(['messages']), []]);
  });
});
