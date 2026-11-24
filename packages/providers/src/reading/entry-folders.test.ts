import { describe, expect, it } from 'vitest';

import { entryFolderWith } from '../testing/entry-problems.ts';

const tracker = [
  'name: tracker',
  'title: Tracker',
  'description: Read and change issues.',
  'website: https://developer.tracker.example.com',
  'type: mcp',
  'url: https://tracker.example.com/mcp',
  'credentials:',
  '  - kind: none',
  '',
].join('\n');

const notes = [
  'name: notes',
  'title: Notes',
  'description: Read notes.',
  'website: https://developer.notes.example.com',
  'type: openapi',
  'document: documents/notes.openapi.json',
  'credentials:',
  '  - kind: none',
  '',
].join('\n');

const invalid = 'The entries of the providers are invalid: ';

const served = JSON.stringify({ openapi: '3.1.0', servers: [{ url: 'https://api.notes.example.com/v1/' }], paths: {} });

const unserved = JSON.stringify({ openapi: '3.1.0', paths: {} });

function servedAt(url: string): string {
  return JSON.stringify({ openapi: '3.1.0', servers: [{ url }], paths: {} });
}

describe('a folder of entries', () => {
  it('is read with the server of a document beside it, or the address of a document an entry names by URL', async () => {
    const remote = notes.replace('documents/notes.openapi.json', 'https://notes.example.com/openapi.json');
    const beside = { 'notes.yaml': notes, 'tracker.yaml': tracker, 'documents/notes.openapi.json': served };

    expect(await entryFolderWith(beside).read()).toBe(
      'notes https://api.notes.example.com/v1; tracker https://tracker.example.com/mcp',
    );
    expect(await entryFolderWith({ 'notes.yaml': remote, 'README.md': '# Entries' }).read()).toBe(
      'notes https://notes.example.com/openapi.json',
    );
  });

  it('is sorted by the names of the providers, not of their files', async () => {
    const slack = tracker.replace('name: tracker', 'name: slack');
    const slackBot = tracker.replace('name: tracker', 'name: slack-bot');

    expect(await entryFolderWith({ 'slack.yaml': slack, 'slack-bot.yaml': slackBot }).read()).toBe(
      'slack https://tracker.example.com/mcp; slack-bot https://tracker.example.com/mcp',
    );
  });
});

describe('a folder of entries the runtime refuses', () => {
  it('is refused with the file, the line and the key of each problem, as a settings file is', async () => {
    const refused = await entryFolderWith({
      'tracker.yaml': tracker.replace('  - kind: none', '  - kind: reference'),
      'notes.yaml': notes.replace('name: notes', 'name: notebook').replace('/notes.', '/notebook.'),
      'broken.yaml': 'name: [broken\n',
      'anchored.yaml': 'name: &name tracker\n',
    }).read();

    expect(refused.split('; ')).toEqual([
      `${invalid}<entries>/anchored.yaml:1:13: Anchors are not allowed in a provider's entry`,
      '<entries>/broken.yaml:2:1: Flow sequence in block collection must be sufficiently indented and end with a ]',
      '<entries>/notes.yaml:1:7 name: Expected the name the file is named for, as in notebook.yaml',
      '<entries>/tracker.yaml:8:11 credentials[0].kind: Expected "secret" | "client_credentials" | "none" | "authorization" | "jwt_bearer" | "token_exchange"',
    ]);
  });

  it('refuses a document that is not one beside the entries named as a provider is, or that is not there', async () => {
    const elsewhere = notes.replace('documents/notes.openapi.json', 'documents/Notes.openapi.json');
    const at = `${invalid}<entries>/notes.yaml:6:11 document`;

    expect(
      await Promise.all([
        entryFolderWith({ 'notes.yaml': elsewhere }).read(),
        entryFolderWith({ 'notes.yaml': notes }).read(),
        entryFolderWith({ 'notes.yaml': notes, 'documents/notes.openapi.json': '{ not json' }).read(),
      ]),
    ).toEqual([
      `${at}: Expected an https URL, or an http URL on a loopback address, written out up to its host, with each placeholder in its place, or documents/<name>.openapi.json, a document beside the entries named as a provider is`,
      `${at}: Expected documents/notes.openapi.json beside the entries, an OpenAPI document in JSON`,
      `${at}: Expected documents/notes.openapi.json beside the entries, an OpenAPI document in JSON`,
    ]);
  });

  it('takes one document beside the entries for two entries of one HTTP API, read once under the name both write', async () => {
    const notesBot = notes.replace('name: notes', 'name: notes-bot');

    expect(
      await entryFolderWith({
        'notes.yaml': notes,
        'notes-bot.yaml': notesBot,
        'documents/notes.openapi.json': served,
      }).read(),
    ).toBe('notes https://api.notes.example.com/v1; notes-bot https://api.notes.example.com/v1');
  });
});

function aliased(text: string, ...aliases: readonly string[]): string {
  return text.replace(
    'credentials:',
    ['aliases:', ...aliases.map((alias) => `  - ${alias}`), 'credentials:'].join('\n'),
  );
}

function taken(alias: string, another: string): string {
  return `Expected a name no other provider is found by: the provider ${another} is found by ${alias}`;
}

const remoteNotes = notes.replace('documents/notes.openapi.json', 'https://notes.example.com/openapi.json');

describe('the other names of the entries of a folder', () => {
  it('are refused where one is another entry’s name or other name, at each entry that declares it', async () => {
    expect(
      (
        await entryFolderWith({
          'notes.yaml': aliased(remoteNotes, 'jottings', 'tracker'),
          'tracker.yaml': aliased(tracker, 'issues', 'jottings'),
        }).read()
      ).split('; '),
    ).toEqual([
      `${invalid}<entries>/notes.yaml:8:5 aliases[0]: ${taken('jottings', 'tracker')}`,
      `<entries>/notes.yaml:9:5 aliases[1]: ${taken('tracker', 'tracker')}`,
      `<entries>/tracker.yaml:9:5 aliases[1]: ${taken('jottings', 'notes')}`,
    ]);
  });

  it('are read where each finds its entry alone', async () => {
    expect(
      await entryFolderWith({
        'notes.yaml': aliased(remoteNotes, 'jottings'),
        'tracker.yaml': aliased(tracker, 'issues'),
      }).read(),
    ).toBe('notes https://notes.example.com/openapi.json; tracker https://tracker.example.com/mcp');
  });
});

describe('the server of a document beside the entries', () => {
  it('is refused where the document names none, unless the entry gives base_url', async () => {
    const based = `${notes}base_url: https://api.notes.example.com\n`;

    expect(
      await Promise.all([
        entryFolderWith({ 'notes.yaml': notes, 'documents/notes.openapi.json': unserved }).read(),
        entryFolderWith({ 'notes.yaml': based, 'documents/notes.openapi.json': unserved }).read(),
      ]),
    ).toEqual([
      `${invalid}<entries>/notes.yaml:6:11 document: The document names no server, so the entry gives base_url`,
      'notes https://api.notes.example.com',
    ]);
  });

  it('is refused where the first is no pinned URL written out, unless the entry gives base_url', async () => {
    const refusal = `${invalid}<entries>/notes.yaml:6:11 document: The first server the document names is no https URL, or http URL on a loopback address, without a variable, so the entry gives base_url`;

    expect(
      await Promise.all([
        entryFolderWith({ 'notes.yaml': notes, 'documents/notes.openapi.json': servedAt('/v1') }).read(),
        entryFolderWith({
          'notes.yaml': notes,
          'documents/notes.openapi.json': servedAt('http://notes.example.com'),
        }).read(),
        entryFolderWith({
          'notes.yaml': notes,
          'documents/notes.openapi.json': servedAt('https://{region}.notes.example.com'),
        }).read(),
      ]),
    ).toEqual([refusal, refusal, refusal]);
  });
});

function iconed(text: string, ...icons: readonly string[]): string {
  return text.replace('type: ', ['icons:', ...icons, 'type: '].join('\n'));
}

const aMark =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#1A2B3C" d="M0 0h24v24H0z"/></svg>\n';

const aPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const lightAndDark = [
  '  - src: icons/tracker.svg',
  '    theme: light',
  '  - src: icons/tracker-dark.png',
  '    theme: dark',
];

function placesIn(refused: string): readonly string[] {
  return refused.match(/<entries>\/\S+ [a-z][^\s:]*(?=:)/gu) ?? [];
}

describe('the icons of the entries of a folder', () => {
  it('are read beside the entries as data URIs of the type their bytes show, each with its theme, and none for an entry that declares none', async () => {
    expect(
      await entryFolderWith({
        'tracker.yaml': iconed(tracker, ...lightAndDark),
        'notes.yaml': remoteNotes,
        'icons/tracker.svg': aMark,
        'icons/tracker-dark.png': aPng,
      }).icons(),
    ).toBe('notes: ; tracker: image/svg+xml light data:image/svg+xml;base64, image/png dark data:image/png;base64');
  });

  it('are refused where the file is not beside the entries, is no image the runtime takes, or is not of the type the entry says', async () => {
    const refused = await entryFolderWith({
      'tracker.yaml': iconed(
        tracker,
        '  - src: icons/missing.svg',
        '  - src: icons/script.svg',
        '  - src: icons/tracker.svg',
        '    mimeType: image/png',
      ),
      'icons/script.svg': aMark.replace('<path', '<script>alert(1)</script><path'),
      'icons/tracker.svg': aMark,
    }).icons();

    expect(placesIn(refused)).toEqual([
      '<entries>/tracker.yaml:6:10 icons[0].src',
      '<entries>/tracker.yaml:7:10 icons[1].src',
      '<entries>/tracker.yaml:9:15 icons[2].mimeType',
    ]);
  });

  it('are refused where one names no file of the folder of icons or no size an icon is made for', async () => {
    const refused = await entryFolderWith({
      'notes.yaml': iconed(remoteNotes, '  - src: ../tracker.yaml', '    sizes: [large]'),
    }).icons();

    expect(placesIn(refused)).toEqual([
      '<entries>/notes.yaml:6:10 icons[0].src',
      '<entries>/notes.yaml:7:13 icons[0].sizes[0]',
    ]);
  });

  it('are refused beside the problems of the document of the same entry', async () => {
    const refused = await entryFolderWith({ 'notes.yaml': iconed(notes, '  - src: icons/notes.svg') }).icons();

    expect(placesIn(refused)).toEqual(['<entries>/notes.yaml:8:11 document', '<entries>/notes.yaml:6:10 icons[0].src']);
  });
});
