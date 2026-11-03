import { authenticatorFor } from '@on.auto/identity';
import { defineQuery, studioLinkTo, withStudioLink } from '@on.auto/operations';
import { Context, Effect, Option, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession } from '../testing/mcp-clients.ts';
import { acmeAdmin, operationServer, type OperationServerOptions } from '../testing/operation-server.ts';
import { servedStudio } from '../testing/studios.ts';

class Invocation extends Context.Service<Invocation, string>()('test/Invocation') {}

const linkTheRun = defineQuery('playbook', {
  name: 'link_the_run',
  title: 'Link the run',
  description: "Links Studio's home and a run's page there. Use it to open Studio. It answers both links.",
  route: { method: 'GET', path: '/run-link' },
  inputSchema: Schema.Struct({ run: Schema.optionalKey(Schema.String.annotate({ description: 'The run to link' })) }),
  outputSchema: Schema.Struct({
    invocation: Schema.String,
    home: Schema.optionalKey(Schema.String),
    studio: Schema.optionalKey(Schema.String),
  }),
  reasons: [],
  handle: ({ run = 'r-1' }) =>
    Effect.gen(function* () {
      const invocation = Option.getOrElse(yield* Effect.serviceOption(Invocation), () => 'none');
      const home = yield* studioLinkTo();
      return yield* withStudioLink(home === undefined ? { invocation } : { invocation, home }, {
        kind: 'run',
        playbook: 'alpha',
        run,
      });
    }),
  plainLanguage: { task: 'link the run', attempt: () => 'link the run', outcome: () => 'Linked.' },
});

const closings: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closings.splice(0).map((close) => close()));
});

async function listeningWith(options: OperationServerOptions): Promise<Listening> {
  const server = await operationServer({ operations: [linkTheRun], ...options });
  const listening = await listenOnLoopback(server.handler);
  closings.push(async () => {
    await listening.close();
    await server.runtime.dispose();
  });
  return listening;
}

const asked = { authorization: `Bearer ${acmeAdmin.key}` };

function reachedAt(publicUrl: string) {
  return {
    ...authenticatorFor({ host: '0.0.0.0', apiKeys: [acmeAdmin.entry] }),
    resource: { publicUrl, authorizationServers: [] },
  };
}

async function answeredOverHttp(options: OperationServerOptions = {}): Promise<unknown> {
  const server = await operationServer({ operations: [linkTheRun], ...options });
  closings.push(() => server.runtime.dispose());
  const answer = await call(server.handler, '/v1/orgs/acme/playbooks/alpha/run-link', { headers: asked });
  return answer.body;
}

describe('the links of a call over HTTP to pages in Studio', () => {
  it("name the Studio host and the runtime at the origin of the request, with the run's page", async () => {
    expect(await answeredOverHttp()).toEqual({
      invocation: 'none',
      home: 'https://studio.on.auto/?server=http%3A%2F%2Flocalhost&src=agent',
      studio: 'https://studio.on.auto/?server=http%3A%2F%2Flocalhost&src=agent&playbook=alpha&ledger=&run=r-1',
    });
  });

  it('name the public address the runtime is reached at, where it has one', async () => {
    expect(await answeredOverHttp({ authenticator: reachedAt('https://runtime.example') })).toMatchObject({
      home: 'https://studio.on.auto/?server=https%3A%2F%2Fruntime.example&src=agent',
    });
  });

  it('are none where the runtime is reached at an http address off this computer, which Studio would not open', async () => {
    expect(await answeredOverHttp({ authenticator: reachedAt('http://runtime.example') })).toEqual({
      invocation: 'none',
    });
  });

  it('join the context the shell makes of the request, which still reaches the call', async () => {
    expect(await answeredOverHttp({ callContext: () => Context.make(Invocation, 'invocation-7') })).toMatchObject({
      invocation: 'invocation-7',
      studio: 'https://studio.on.auto/?server=http%3A%2F%2Flocalhost&src=agent&playbook=alpha&ledger=&run=r-1',
    });
  });
});

describe('the links of a tool of an MCP endpoint to pages in Studio', () => {
  it('are the Studio the runtime serves, and name no install, though the runtime has one', async () => {
    const server = await listeningWith({ studio: servedStudio, installId: () => 'install-1' });
    const named = `server=${encodeURIComponent(server.origin)}&src=agent`;

    const result = await withMcpSession(
      'current revision',
      { url: `${server.origin}/orgs/acme/playbooks/alpha/mcp`, headers: asked },
      (session) => session.callTool('link_the_run', { run: 'r-2' }),
    );

    expect(result.structuredContent).toEqual({
      invocation: 'none',
      home: `${server.origin}/studio/?${named}`,
      studio: `${server.origin}/studio/?${named}&playbook=alpha&ledger=&run=r-2`,
    });
  });
});
