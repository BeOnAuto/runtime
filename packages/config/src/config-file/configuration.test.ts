import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  configFileWith,
  configured,
  exampleSettings,
  messageOf,
  problemsIn,
  temporaryDirectory,
} from '../testing/config-files.ts';
import { configurationOf } from './configuration.ts';

const gateways = `example_gateways:
  - name: gateway
    api_key: \${GATEWAY_KEY}
    headers: { x-tenant: acme }
example_origins:
  - https://app.example.com
  - https://admin.example.com
`;

describe('the configuration without CONFIG_FILE', () => {
  it('is the environment as it is', () => {
    const environment = { EXAMPLE_ORIGINS: 'https://app.example.com' };

    expect(configurationOf(environment, exampleSettings)).toEqual(Result.succeed({ environment, file: undefined }));
    expect(configurationOf({ ...environment, CONFIG_FILE: '' }, exampleSettings)).toEqual(
      Result.succeed({ environment: { ...environment, CONFIG_FILE: '' }, file: undefined }),
    );
  });
});

describe('a configuration file', () => {
  it('gives each setting it holds as the environment variable of the same name would', () => {
    const { environment, file } = configured(gateways, { GATEWAY_KEY: 'key-from-the-environment' });

    expect(environment).toMatchObject({
      EXAMPLE_GATEWAYS: JSON.stringify([
        { name: 'gateway', api_key: 'key-from-the-environment', headers: { 'x-tenant': 'acme' } },
      ]),
      EXAMPLE_ORIGINS: 'https://app.example.com,https://admin.example.com',
    });
    expect(file).toMatchObject({
      fromFile: ['EXAMPLE_GATEWAYS', 'EXAMPLE_ORIGINS'],
      overridden: [],
      referenced: ['GATEWAY_KEY'],
    });
  });

  it('gives way to an environment variable that sets the same setting, whole', () => {
    const { environment, file } = configured(gateways, {
      GATEWAY_KEY: 'k',
      EXAMPLE_ORIGINS: 'https://other.example.com',
    });

    expect(environment['EXAMPLE_ORIGINS']).toBe('https://other.example.com');
    expect(file).toMatchObject({ fromFile: ['EXAMPLE_GATEWAYS'], overridden: ['EXAMPLE_ORIGINS'] });
  });

  it('is not overridden by an environment variable that is empty', () => {
    const { environment, file } = configured(gateways, { GATEWAY_KEY: 'k', EXAMPLE_ORIGINS: '' });

    expect(environment['EXAMPLE_ORIGINS']).toBe('https://app.example.com,https://admin.example.com');
    expect(file?.overridden).toEqual([]);
  });

  it('may be empty, or hold only comments', () => {
    expect(configured('# nothing yet\n').file).toMatchObject({ fromFile: [], overridden: [] });
  });
});

describe('the place of a setting the file holds', () => {
  it('names where a setting it holds is, by file, line, column and key, or the nearest place it is', () => {
    const path = configFileWith(gateways);
    const { file } = Result.getOrThrow(configurationOf({ CONFIG_FILE: path, GATEWAY_KEY: 'k' }, exampleSettings));

    expect(file?.place('EXAMPLE_GATEWAYS', '/0/headers/x-tenant')).toBe(
      `${path}:4:26 example_gateways[0].headers.x-tenant`,
    );
    expect(file?.place('EXAMPLE_GATEWAYS', '/0/missing')).toBe(`${path}:2:5 example_gateways[0].missing`);
    expect(file?.placed({ setting: 'EXAMPLE_GATEWAYS', pointer: '/0/name', detail: 'gateway is used twice' })).toBe(
      `${path}:2:11 example_gateways[0].name: gateway is used twice`,
    );
    expect(file?.placed({ setting: 'EXAMPLE_GATEWAYS', pointer: '', detail: 'Expected a list' })).toBe(
      `${path}:2:3 example_gateways: Expected a list`,
    );
    expect(file?.placed({ setting: 'EXAMPLE_ORIGINS', detail: 'Expected text' })).toBe(
      `${path}:6:3 example_origins: Expected text`,
    );
    expect(file?.place('EXAMPLE_GATEWAYS', '/0/headers/a~1b')).toBe(`${path}:4:14 example_gateways[0].headers["a/b"]`);
  });
});

describe('a reference to an environment variable', () => {
  it('is replaced by the variable, in either form, with its default when the variable is not set', () => {
    const { environment } = configured(
      'example_origins: ["https://${HOST}", "https://${env:HOST}:${PORT:-8443}", "https://a.example/$${HOST}$$"]\n',
      { HOST: 'app.example.com' },
    );

    expect(environment['EXAMPLE_ORIGINS']).toBe(
      'https://app.example.com,https://app.example.com:8443,https://a.example/${HOST}$',
    );
  });

  it('stops the reading when its variable is not set, naming the variable and never a value', () => {
    expect(problemsIn(gateways, { GATEWAY_KEY: '' })).toBe(
      'The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:3:14 example_gateways[0].api_key: Refers to the environment variable GATEWAY_KEY, which is not set',
    );
  });

  it('stops the reading when it is not a reference to a variable', () => {
    expect(problemsIn('example_origins: ["https://${1HOST}"]\n')).toBe(
      'The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:19 example_origins[0]: Holds a ${…} that is not a reference to an environment variable; write ${NAME}, or $$ for a literal $',
    );
  });
});

describe('a setting that keeps its references', () => {
  const servers = 'example_servers:\n  graph:\n    headers: { authorization: "Bearer ${GRAPH_KEY}", x-price: "$$5" }\n';

  it('is given as written, for its own reader to resolve, once every variable it names is set', () => {
    const { environment } = configured(servers, { GRAPH_KEY: 'key-from-the-environment' });

    expect(environment['EXAMPLE_SERVERS']).toBe(
      JSON.stringify({ graph: { headers: { authorization: 'Bearer ${GRAPH_KEY}', 'x-price': '$$5' } } }),
    );
  });

  it('stops the reading when a variable it names is not set, as any setting does', () => {
    expect(problemsIn(servers)).toBe(
      'The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:3:31 example_servers.graph.headers.authorization: Refers to the environment variable GRAPH_KEY, which is not set',
    );
  });
});

const secret = 'sk-proj-0123456789abcdefghijklmnop';

const writtenOut =
  'Looks like a credential, which this file never holds; write a reference to the environment variable that holds it instead, such as ${GATEWAY_API_KEY}';

describe('a credential written in the file', () => {
  it.each([
    [
      'in a key that holds a credential',
      `example_gateways: [{ name: g, api_key: plain-text }]\n`,
      '1:40 example_gateways[0].api_key',
    ],
    [
      'in a header that carries a credential',
      `example_gateways: [{ name: g, headers: { authorization: plain-text } }]\n`,
      '1:57 example_gateways[0].headers.authorization',
    ],
    [
      'in the shape of a key, wherever it is',
      `example_gateways: [{ name: ${secret} }]\n`,
      '1:28 example_gateways[0].name',
    ],
    ['as a scheme and a token', `example_origins: ["Bearer abc.def"]\n`, '1:19 example_origins[0]'],
  ])('is refused %s, without the value', (_, text, place) => {
    const message = problemsIn(text);

    expect(message).toBe(
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:${place}: Looks like a credential, which this file never holds; write a reference to the environment variable that holds it instead, such as \${GATEWAY_API_KEY}`,
    );
    expect(message).not.toContain('plain-text');
    expect(message).not.toContain(secret);
  });

  it('is welcome as a reference, with text around it that is not a credential', () => {
    const { environment } = configured(
      'example_gateways: [{ name: g, api_key: "${KEY}", headers: { authorization: "Bearer ${TOKEN}" }, enabled: true }]\n',
      { KEY: 'k', TOKEN: 't' },
    );

    expect(environment['EXAMPLE_GATEWAYS']).toBe(
      JSON.stringify([{ name: 'g', api_key: 'k', headers: { authorization: 'Bearer t' }, enabled: true }]),
    );
  });
});

describe('a credential written in a URL or an argument', () => {
  it.each([
    [
      'as the user and password of a URL',
      `example_gateways: [{ name: g, base_url: "https://user:plain-text@a.example/v1" }]\n`,
      '1:41 example_gateways[0].base_url',
    ],
    [
      'as the user of a URL, in the shape of a key',
      `example_gateways: [{ name: g, base_url: "https://${secret}@a.example/v1" }]\n`,
      '1:41 example_gateways[0].base_url',
    ],
    [
      'in the query of a URL, in the shape of a key',
      `example_gateways: [{ name: g, base_url: "https://a.example/v1?q=${secret}" }]\n`,
      '1:41 example_gateways[0].base_url',
    ],
    [
      'after the = of an argument, in the shape of a key',
      `example_gateways: [{ name: g, args: ["--key=sk-live-x"] }]\n`,
      '1:38 example_gateways[0].args[0]',
    ],
  ])('is refused %s, without the value', (_, text, place) => {
    const message = problemsIn(text);

    expect(message).toBe(
      `The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:${place}: ${writtenOut}`,
    );
    expect(message).not.toContain('plain-text');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('sk-live-x');
  });

  it('judges the values of an argument and of a URL, never the names of an argument', () => {
    const plain = {
      link: 'https://a.example/v1?api-version=2026-01-01',
      mode: '--mode=read',
      tokenFile: '--token-file=/run/secrets/notes',
      keyEnv: '--api-key-env=NOTES_API_KEY',
      bare: '=x',
      empty: '--key=',
    };
    const { environment } = configured(`example_servers: { graph: { headers: ${JSON.stringify(plain)} } }\n`);

    expect(environment['EXAMPLE_SERVERS']).toBe(JSON.stringify({ graph: { headers: plain } }));
  });
});

describe('a configuration file that is not one the server reads', () => {
  it('is named with the reason when it is missing, a directory, unreadable or too large', () => {
    const directory = temporaryDirectory();
    const locked = join(directory, 'locked.yaml');
    writeFileSync(locked, 'example_origins: []\n');
    chmodSync(locked, 0o000);
    const large = join(directory, 'large.yaml');
    writeFileSync(large, `# ${'x'.repeat(1_048_576)}\n`);
    mkdirSync(join(directory, 'folder.yaml'));

    expect(messageOf(join(directory, 'missing.yaml'))).toBe(
      `The configuration file ${join(directory, 'missing.yaml')}, which CONFIG_FILE names, does not exist`,
    );
    expect(messageOf(join(directory, 'folder.yaml'))).toBe(
      `The configuration file ${join(directory, 'folder.yaml')}, which CONFIG_FILE names, is a directory`,
    );
    expect(messageOf(locked)).toBe(
      `The configuration file ${locked}, which CONFIG_FILE names, could not be read (EACCES)`,
    );
    expect(messageOf(large)).toBe(`The configuration file ${large}, which CONFIG_FILE names, is larger than 1 MiB`);
  });

  it('is refused at the place of each problem when it is not YAML this server reads', () => {
    expect(problemsIn('example_origins: [https://a.example\nexample_origins: 2\n')).toBe(
      'The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:2:1: Flow sequence in block collection must be sufficiently indented and end with a ]; auto-runtime.yaml:2:1: Map keys must be unique',
    );
    expect(problemsIn('shared: &shared []\nexample_origins: *shared\n')).toBe(
      'The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:17: Anchors are not allowed in the configuration file; auto-runtime.yaml:2:18: Aliases are not allowed in the configuration file',
    );
    expect(problemsIn('- a list\n')).toBe(
      'The configuration file auto-runtime.yaml is invalid: auto-runtime.yaml:1:1: The configuration file is a YAML mapping from setting names to values',
    );
  });

  it('is refused for a key it does not hold and a value its setting does not accept, never quoting the value', () => {
    const message = problemsIn(
      'example_origins: [http://plain.example]\nexample_gateways: [{ name: 7, colour: blue }]\nport: 5555\n',
    );

    expect(message).toBe(
      'The configuration file auto-runtime.yaml is invalid: ' +
        'auto-runtime.yaml:1:19 example_origins[0]: Expected a string matching the RegExp ^https:\\/\\/; ' +
        'auto-runtime.yaml:2:28 example_gateways[0].name: Expected string; ' +
        'auto-runtime.yaml:2:39 example_gateways[0].colour: Expected no excess property; ' +
        'auto-runtime.yaml:3:7 port: Not a setting this file holds; it holds example_gateways, example_origins, example_servers, example_rules',
    );
  });
});
