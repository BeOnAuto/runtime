import { settingProblemText } from '@on.auto/config';
import { Effect, Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import { readToolServerSettings, type Environment, type ServerSettings } from '../index.ts';

const context = { modelProviders: ['openai', 'anthropic', 'gateway'] };

const apiKey = 'graph-api-key-4f1d9a7c2b';

const secrets = { GRAPH_API_KEY: apiKey, GRAPH_CLIENT_SECRET: 'graph-client-secret-81c2' };

const graph = { url: 'https://graph.example.com/mcp', org: 'acme' };

const limitless = { command: '/usr/local/bin/limitless-mcp-server', org: 'acme' };

const clientSecret = { client_id: 'playbook', client_secret: '${GRAPH_CLIENT_SECRET}' };

function environmentOf(servers: unknown): Environment {
  return { ...secrets, TOOL_SERVERS: JSON.stringify(servers) };
}

function serversOf(servers: unknown): readonly ServerSettings[] {
  return Effect.runSync(readToolServerSettings(environmentOf(servers), context)).servers;
}

function refusalOf(environment: Environment) {
  return Effect.runSync(Effect.flip(readToolServerSettings(environment, context)));
}

function problemsOf(servers: unknown): readonly string[] {
  return refusalOf(environmentOf(servers)).problems.map((problem) => settingProblemText(problem));
}

function plain(values: ReadonlyMap<string, Redacted.Redacted>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...values].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

function secretValuesOf(server: ServerSettings | undefined): Readonly<Record<string, string>> {
  if (server === undefined) {
    return {};
  }
  return plain(server.type === 'stdio' ? server.env : server.headers);
}

describe('reading an mcp server', () => {
  it('reads no server when no setting is set', () => {
    expect(Effect.runSync(readToolServerSettings({}, context))).toEqual({ servers: [], referencedVariables: [] });
  });

  it('reads an mcp entry with its headers resolved and redacted, and its org and playbooks', () => {
    const [server] = serversOf({
      graph: {
        ...graph,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
        playbooks: ['sales', 'support'],
        record_content: true,
        request_id: 'x-request-id',
      },
    });

    expect(server).toMatchObject({
      name: 'graph',
      type: 'mcp',
      url: graph.url,
      auth: null,
      orgs: ['acme'],
      playbooks: ['sales', 'support'],
      allowed: null,
      record_content: true,
      request_id: 'x-request-id',
    });
    expect(secretValuesOf(server)).toEqual({ Authorization: `Bearer ${apiKey}` });
    expect(JSON.stringify(server)).not.toContain(apiKey);
  });

  it('reads an explicit mcp type and an entry with no headers', () => {
    expect(serversOf({ graph: { ...graph, type: 'mcp' } })).toMatchObject([{ type: 'mcp', headers: new Map() }]);
  });
});

describe('reading a stdio server', () => {
  it('reads a stdio entry with its own environment and arguments, keeping content where it says nothing of it', () => {
    const [server] = serversOf({
      limitless: { ...limitless, type: 'stdio', args: ['--port', '0'], env: { LIMITLESS_API_KEY: '${GRAPH_API_KEY}' } },
    });

    expect(server).toMatchObject({
      name: 'limitless',
      type: 'stdio',
      command: limitless.command,
      args: ['--port', '0'],
      playbooks: null,
      record_content: true,
      request_id: null,
    });
    expect(secretValuesOf(server)).toEqual({ LIMITLESS_API_KEY: apiKey });
  });

  it('keeps no content of an entry that turns keeping off', () => {
    expect(serversOf({ limitless: { ...limitless, record_content: false } })).toMatchObject([
      { type: 'stdio', record_content: false },
    ]);
  });

  it('reads a stdio entry with no arguments and no environment', () => {
    expect(serversOf({ limitless })).toMatchObject([{ type: 'stdio', args: [], env: new Map() }]);
  });
});

describe('the shape of the servers', () => {
  it('refuses a setting that is not JSON, or not the shape of the servers', () => {
    expect(refusalOf({ TOOL_SERVERS: '{graph' }).problems).toEqual([
      { setting: 'TOOL_SERVERS', pointer: '', detail: 'Expected JSON' },
    ]);
    expect(problemsOf({ graph: { ...graph, port: 8 } })).toEqual([
      'TOOL_SERVERS: /graph/port: Expected no excess property',
    ]);
    expect(problemsOf([])).toEqual([expect.stringMatching(/^TOOL_SERVERS: \/: Expected object/u)]);
  });

  it('refuses an entry with none of url, command and document, or with two of them', () => {
    const oneOfThree =
      'TOOL_SERVERS: /graph: Expected url for an mcp server, command for a stdio server or document for an openapi server, one of the three';

    expect(problemsOf({ graph: { org: 'acme' } })).toEqual([oneOfThree]);
    expect(problemsOf({ graph: { ...graph, command: 'graph' } })).toEqual([oneOfThree]);
    expect(problemsOf({ graph: { ...graph, document: 'https://graph.example.com/openapi.json' } })).toEqual([
      oneOfThree,
    ]);
  });

  it('refuses a typed entry without the field its type needs', () => {
    expect(problemsOf({ graph: { org: 'acme', type: 'mcp' } })).toEqual([
      'TOOL_SERVERS: /graph: Expected url for an mcp server',
    ]);
    expect(problemsOf({ limitless: { org: 'acme', type: 'stdio', url: graph.url } })).toEqual([
      'TOOL_SERVERS: /limitless/url: Not a field of a stdio server',
      'TOOL_SERVERS: /limitless: Expected command for a stdio server',
    ]);
  });
});

describe('the fields of the other type', () => {
  it('refuses the fields of a stdio server on an mcp server', () => {
    expect(problemsOf({ graph: { ...graph, type: 'mcp', command: 'graph', args: [], env: {} } })).toEqual([
      'TOOL_SERVERS: /graph/command: Not a field of an mcp server',
      'TOOL_SERVERS: /graph/args: Not a field of an mcp server',
      'TOOL_SERVERS: /graph/env: Not a field of an mcp server',
    ]);
  });

  it('refuses the fields of an mcp or an openapi server on a stdio server', () => {
    const auth = { ...clientSecret, issuer: 'https://auth.example.com' };

    const api = { document: 'openapi.json', base_url: 'https://api.example.com', query_params: {} };

    expect(
      problemsOf({ limitless: { ...limitless, type: 'stdio', url: graph.url, headers: {}, auth, ...api } }),
    ).toEqual([
      'TOOL_SERVERS: /limitless/url: Not a field of a stdio server',
      'TOOL_SERVERS: /limitless/headers: Not a field of a stdio server',
      'TOOL_SERVERS: /limitless/auth: Not a field of a stdio server',
      'TOOL_SERVERS: /limitless/document: Not a field of a stdio server',
      'TOOL_SERVERS: /limitless/base_url: Not a field of a stdio server',
      'TOOL_SERVERS: /limitless/query_params: Not a field of a stdio server',
    ]);
  });
});

describe('the name, org and playbooks of a server', () => {
  it('refuses a name a reasoning function could not write, or could mistake for a model provider or gateway', () => {
    expect(problemsOf({ Graph: graph })).toEqual([
      'TOOL_SERVERS: /Graph: Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
    ]);
    expect(problemsOf({ 'crm--eu': graph, 'crm-': graph })).toEqual([
      "TOOL_SERVERS: /crm--eu: Expected no two hyphens together and none at the end: a model sees each tool of the server as server__tool, a hyphen as an underscore, and the server's name ends at the first __",
      "TOOL_SERVERS: /crm-: Expected no two hyphens together and none at the end: a model sees each tool of the server as server__tool, a hyphen as an underscore, and the server's name ends at the first __",
    ]);
    expect(problemsOf({ openai: graph, gateway: graph })).toEqual([
      'TOOL_SERVERS: /openai: The name of a model provider or gateway, which a reasoning function could not tell apart from it',
      'TOOL_SERVERS: /gateway: The name of a model provider or gateway, which a reasoning function could not tell apart from it',
    ]);
  });

  it('refuses an entry without its org, or with an org or playbook that is not an id, with every other problem', () => {
    expect(problemsOf({ Graph: { url: graph.url } })).toEqual([
      'TOOL_SERVERS: /Graph: Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter',
      'TOOL_SERVERS: /Graph: Expected the org this server serves',
    ]);
    expect(problemsOf({ graph: { ...graph, org: 'acme corp', playbooks: ['sales', 'Support Desk'] } })).toEqual([
      'TOOL_SERVERS: /graph/org: Expected an org id, a list of them, or *',
      'TOOL_SERVERS: /graph/playbooks/1: Expected a playbook id',
    ]);
  });
});

describe('the transport of a server', () => {
  it('refuses a url that is not http, a header name that is not one, and a header the client sets itself', () => {
    const headers = { 'X Graph': 'one', 'Mcp-Session-Id': 'two', Host: 'graph.example.com' };

    expect(problemsOf({ graph: { url: 'ftp://graph.example.com/mcp', org: 'acme', headers } })).toEqual([
      'TOOL_SERVERS: /graph/url: Expected an http or https URL',
      'TOOL_SERVERS: /graph/headers/X Graph: Expected a header name',
      'TOOL_SERVERS: /graph/headers/Mcp-Session-Id: A header the MCP client sets itself',
      'TOOL_SERVERS: /graph/headers/Host: A header the MCP client sets itself',
    ]);
  });

  it("refuses every header that opens a cloud's instance metadata service, in any case", () => {
    const headers = {
      'Metadata-Flavor': 'Google',
      Metadata: 'true',
      'X-Google-Metadata-Request': 'True',
      'X-aws-ec2-metadata-token': '${GRAPH_API_KEY}',
      'X-AWS-EC2-METADATA-TOKEN-TTL-SECONDS': '${GRAPH_API_KEY}',
    };
    const refusal = "A header that opens a cloud's instance metadata service, which no tool server is sent";

    expect(problemsOf({ graph: { url: 'https://graph.example.com/mcp', org: 'acme', headers } })).toEqual(
      Object.keys(headers).map((header) => `TOOL_SERVERS: /graph/headers/${header}: ${refusal}`),
    );
  });

  it('refuses a blank command and an environment variable that is not a name', () => {
    expect(problemsOf({ limitless: { ...limitless, command: ' ', env: { '1KEY': 'one', 'A-B': 'two' } } })).toEqual([
      'TOOL_SERVERS: /limitless/command: Expected a command',
      'TOOL_SERVERS: /limitless/env/1KEY: Expected an environment variable name',
      'TOOL_SERVERS: /limitless/env/A-B: Expected an environment variable name',
    ]);
  });
});

describe('a credential written into the url or the args of a server', () => {
  it('is refused as userinfo, as a value of the query, and after the = of an argument, never printing it', () => {
    const credential =
      'Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${GRAPH_API_KEY}';
    const refusal = refusalOf(
      environmentOf({
        graph: { ...graph, url: 'https://a.example/mcp?key=sk-live-x' },
        crm: { ...graph, url: 'https://user:sk-x@a.example/mcp' },
        limitless: { ...limitless, args: ['--key=sk-live-x'] },
      }),
    );

    expect(refusal.problems.map(({ pointer = '', detail }) => `${pointer}: ${detail}`)).toEqual([
      `/graph/url: ${credential}`,
      `/crm/url: ${credential}`,
      `/limitless/args/0: ${credential}`,
    ]);
    expect(JSON.stringify(refusal)).not.toContain('sk-');
  });

  it('is judged in an argument by the value, never by the name it is given, and in a query by its name too', () => {
    const notes = { ...limitless, args: ['--token-file=/run/secrets/notes', '--api-key-env=NOTES_API_KEY'] };

    expect(serversOf({ notes }).map(({ name }) => name)).toEqual(['notes']);
    expect(problemsOf({ graph: { ...graph, url: 'https://graph.example.com/mcp?api_key=graph-4f1d9a7c' } })).toEqual([
      'TOOL_SERVERS: /graph/url: Looks like a credential, which this setting never holds; write a reference to the environment variable that holds it instead, such as ${GRAPH_API_KEY}',
    ]);
  });
});

describe('the references of a server', () => {
  it('refuses a reference outside headers, query_params, security, env and auth, where a key would show in a process listing or a URL', () => {
    const misplaced =
      'Holds a reference to an environment variable, which only headers, query_params, security, env and auth may hold: an argument shows in the listing of the processes of the machine, and the URL of a server or of a document is no place for a credential';

    expect(
      problemsOf({
        graph: { ...graph, url: 'https://graph.example.com/mcp?key=${GRAPH_API_KEY}' },
        limitless: { ...limitless, args: ['--key', '${GRAPH_API_KEY}'], command: '${HOME:-/usr/local}/bin/limitless' },
      }),
    ).toEqual([
      `TOOL_SERVERS: /graph/url: ${misplaced}`,
      `TOOL_SERVERS: /limitless/command: ${misplaced}`,
      `TOOL_SERVERS: /limitless/args/1: ${misplaced}`,
    ]);
  });

  it('keeps the values of the references in headers and env as the secrets of the server', () => {
    const [server] = serversOf({
      graph: { ...graph, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Mode': '${MODE:-production}' } },
    });

    expect(server?.secrets.map((secret) => Redacted.value(secret))).toEqual([apiKey]);
  });

  it('keeps the name of every variable the entries refer to, one with a fallback among them', () => {
    const headers = { Authorization: 'Bearer ${GRAPH_API_KEY}', 'X-Region': '${GRAPH_REGION:-eu}' };
    const notes = { ...limitless, env: { NOTES_KEY: '${env:GRAPH_API_KEY}' } };
    const read = Effect.runSync(
      readToolServerSettings(environmentOf({ graph: { ...graph, headers }, notes }), context),
    );

    expect(read.referencedVariables).toEqual(['GRAPH_API_KEY', 'GRAPH_REGION', 'GRAPH_API_KEY']);
  });
});
