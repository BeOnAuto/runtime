import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { serveFakeApi, type FakeApiServer } from '@on.auto/tool-servers/served-fakes';
import { describedAccess, patientTiming } from '@on.auto/tool-servers/testing';
import { Effect, Result } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { providerNamed, providersShippedRoots, readProviders } from '../index.ts';
import { manifestIn } from '../translating/document-manifests.ts';
import { documentsBesideTheEntries } from './shipped-providers.ts';

const providersOnDisk = shippedFilesOnDisk(providersShippedRoots());

const shipped = Result.getOrThrow(await readProviders(providersOnDisk));

const { entry } = Result.getOrThrow(providerNamed(shipped, 'google-drive'));

const manifest = await manifestIn(providersOnDisk, documentsBesideTheEntries, 'google-drive');

const said = new Map(
  (manifest.type === 'discovery' ? (manifest.descriptions ?? []) : []).map(({ operation, says }) => [operation, says]),
);

const clientSecret = 'drive-org-app-secret-3b7c';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Reached {
  readonly fake: FakeApiServer;
  readonly access: Awaited<ReturnType<typeof describedAccess>>['access'];
}

async function atTheFake(): Promise<Reached> {
  const fake = await serveFakeApi({ client: { clientId: 'org-app', clientSecret, expiresInSeconds: 7200 } });
  closing.push(fake.close);
  const { access } = await describedAccess(
    {
      'google-drive': {
        org: 'acme',
        document: relative(
          process.cwd(),
          fileURLToPath(new URL(entry.document ?? '', new URL('../entries/', import.meta.url))),
        ),
        base_url: fake.baseUrl,
        auth: { issuer: String(fake.issuing?.issuer), client_id: 'org-app', client_secret: '${CLIENT_SECRET}' },
      },
    },
    { environment: { CLIENT_SECRET: clientSecret }, timing: patientTiming },
  );
  closing.push(access.close);
  return { fake, access };
}

function called({ access }: Reached, tool: string, input: Readonly<Record<string, unknown>>) {
  return Effect.runPromise(
    Effect.result(
      access.callOnce({ org: 'acme', playbook: 'alpha', reference: { server: 'google-drive', tool }, input, meta: {} }),
    ),
  );
}

function sentTo({ fake }: Reached) {
  return fake
    .seen()
    .filter(({ path }) => path.startsWith('/v1/'))
    .map(({ method, path, query }) => `${method} ${path}${query}`);
}

const textOrTextWithItsType = {
  anyOf: [
    { type: 'string', description: 'A text, sent as text/plain.' },
    expect.objectContaining({ description: 'A text with its media type.', required: ['media_type', 'text'] }),
  ],
};

function toolOf(name: string, more: Readonly<Record<string, unknown>> = {}): unknown {
  return expect.objectContaining({ name, ...more });
}

describe('the tools of google-drive through its shipped document', () => {
  it('upload a file, and give ids for a repeat that is safe, which read, beside the tools there were', async () => {
    const { access } = await atTheFake();

    const listed = await Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' }));

    expect(listed).toEqual([
      expect.objectContaining({
        name: 'google-drive',
        tools: [
          toolOf('drive.files.list', { mark: 'reads' }),
          toolOf('drive.files.create', { mark: 'acts' }),
          toolOf('drive.files.get', { mark: 'reads' }),
          toolOf('drive.permissions.list', { mark: 'reads' }),
          toolOf('drive.files.export', { mark: 'reads' }),
          toolOf('drive.files.create.upload', { mark: 'acts' }),
          toolOf('drive.files.copy', { mark: 'acts' }),
          toolOf('drive.files.generateIds', { mark: 'reads' }),
        ],
      }),
    ]);
  });
});

const uploadTypePinned: unknown = expect.objectContaining({ enum: ['multipart'] });

const uploadProperties: unknown = expect.objectContaining({
  uploadType: uploadTypePinned,
  body: { type: 'array', prefixItems: [{ $ref: '#/$defs/File' }, textOrTextWithItsType], minItems: 2, items: false },
});

const uploadSchema: unknown = expect.objectContaining({
  properties: uploadProperties,
  required: ['uploadType', 'body'],
});

const createAndUpload: unknown = expect.arrayContaining([
  toolOf('drive.files.create', { description: said.get('drive.files.create') }),
  toolOf('drive.files.create.upload', {
    description: said.get('drive.files.create.upload'),
    input_schema: uploadSchema,
  }),
]);

describe('the upload and the create of google-drive through its shipped document', () => {
  it('are described in the words of the manifest, the upload taking a list of the metadata and a text', async () => {
    const { access } = await atTheFake();

    const listed = await Effect.runPromise(access.listServers({ org: 'acme', playbook: 'alpha' }));

    expect(listed).toEqual([
      expect.objectContaining({
        tools: createAndUpload,
      }),
    ]);
  });
});

describe('an upload through google-drive', () => {
  it('sends the metadata and the text, in its own type, to the upload path, as one request', async () => {
    const reached = await atTheFake();
    const metadata = { id: 'pre-generated-1', name: 'Weekly report.md', parents: ['folder-1'] };

    await called(reached, 'drive.files.create.upload', {
      uploadType: 'multipart',
      fields: 'id,name,webViewLink',
      body: [metadata, { media_type: 'text/markdown', text: '# Week\n\nDone.' }],
    });
    const sent = reached.fake.seen().find(({ path }) => path.startsWith('/v1/'));

    expect(sentTo(reached)).toEqual([
      'POST /v1/upload/drive/v3/files?uploadType=multipart&fields=id%2Cname%2CwebViewLink',
    ]);
    expect(sent?.headers['content-type']).toMatch(/^multipart\/related; boundary=auto-/u);
    expect(sent?.body).toContain(
      `Content-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    );
    expect(sent?.body).toContain('Content-Type: text/markdown; charset=utf-8\r\n\r\n# Week\n\nDone.\r\n');
  });
});

const hostile = ['../../gmail/v1/users/me/messages', 'a/../../b', 'x?alt=media#top', 'https://evil.example/', '%2e%2e'];

const byFileId: ReadonlyMap<string, Readonly<Record<string, unknown>>> = new Map([
  ['drive.files.get', {}],
  ['drive.permissions.list', {}],
  ['drive.files.export', { mimeType: 'text/plain' }],
  ['drive.files.copy', { body: {} }],
]);

interface Called {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
}

function eachCall(fileIds: readonly string[]): readonly Called[] {
  return fileIds.flatMap((fileId) =>
    [...byFileId].map(([tool, more]: readonly [string, Readonly<Record<string, unknown>>]) => ({
      tool,
      input: { fileId, ...more },
    })),
  );
}

describe('the address of a call of google-drive, now written from the host', () => {
  it('stays at a path the document declares, each id one segment, and a . or .. is never sent', async () => {
    const reached = await atTheFake();

    await Promise.all(eachCall([...hostile, '..', '.']).map(({ tool, input }: Called) => called(reached, tool, input)));
    const paths = reached.fake
      .seen()
      .filter(({ path }) => path.startsWith('/v1/'))
      .map(({ path }) => path);

    expect(paths).toHaveLength(hostile.length * byFileId.size);
    expect(
      paths.filter((path) => !/^\/v1\/drive\/v3\/files\/[^/]+(?:\/(?:permissions|export|copy))?$/u.test(path)),
    ).toEqual([]);
    expect(new Set(paths.map((path) => decodeURIComponent(String(path.split('/')[5]))))).toEqual(new Set(hostile));
  });
});
