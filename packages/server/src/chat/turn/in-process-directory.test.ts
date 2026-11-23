import { apiShippedRoots, readPageStyle, type RegisterRoutes } from '@on.auto/api';
import { signedInPersonOf } from '@on.auto/identity';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Context, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { inProcessDirectory } from './in-process-directory.ts';

const ada = signedInPersonOf({ subject: 'ada', name: 'Ada', org: 'acme', permissions: [] });

const OfTheServer = Context.Service<string>('test/OfTheServer');

const OfTheTurn = Context.Service<string>('test/OfTheTurn');

const none = () => 'none';

function heldIn(context: Context.Context<never>): readonly string[] {
  return [
    Option.getOrElse(Context.getOption(context, OfTheServer), none),
    Option.getOrElse(Context.getOption(context, OfTheTurn), none),
  ];
}

const whoAsks: RegisterRoutes = (routes) => {
  routes.add('POST', '/whoami', (c) =>
    Response.json({
      id: c.get('principal').own.id,
      held: heldIn(routes.callContext(c.req.raw)),
      unhanded: heldIn(routes.callContext(new Request(c.req.raw.url))),
    }),
  );
};

async function composedIn(directory: ReturnType<typeof inProcessDirectory>) {
  return directory.composed({
    allowedOrigins: [],
    studio: { origin: 'https://studio.example.com', served: false },
    routes: [whoAsks],
    reportIncident: () => {},
    pageStyle: await readPageStyle(shippedFilesOnDisk(apiShippedRoots())),
    callContext: () => Context.make(OfTheServer, 'server'),
  });
}

const asked = () => new Request('https://runtime.example.com/whoami', { method: 'POST' });

describe('the server’s own API, in process, as a person', () => {
  it('answers each call of a turn as the person it acts for, in the server’s context and the turn’s, once the API is composed, and no call made outside one', async () => {
    const directory = inProcessDirectory();
    const answering = directory.asking(ada, Context.make(OfTheTurn, 'turn'), async (send) =>
      (await send(asked())).json(),
    );
    const handler = await composedIn(directory);
    const outside = await handler.fetch(new Request(asked(), { headers: { authorization: 'Bearer handle-9' } }));
    const unnamed = await handler.fetch(asked());

    expect([await answering, outside.status, unnamed.status]).toEqual([
      { id: ada.own.id, held: ['server', 'turn'], unhanded: ['server', 'none'] },
      401,
      401,
    ]);
    await handler.close();
  });
});
