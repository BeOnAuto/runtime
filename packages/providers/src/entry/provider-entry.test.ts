import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { adverts, audiences, drive, ledgers, regions, tracker } from '../testing/fixture-providers.ts';

const placesOtherwise =
  'Expected an https URL, or an http URL on a loopback address, written out up to its host, with each placeholder in its place';

const heldCredential =
  "Looks like a credential, which a provider's entry never holds: the person gives the credential on the page a connection's link opens";

const unplaced =
  'Expected the placeholder in the address, a header or a query value of the provider, since nothing else takes it';

const setAndDeclared =
  'Expected api_host, which a choice sets, in the address, a header or a query value, and never among the placeholders';

const clientIdElsewhere =
  'Holds {client_id}, which only a header or query value of a provider whose every way is client_credentials or authorization holds';

const optionalElsewhere =
  'Holds the optional placeholder {manager}, which stands only as the whole value of a header or a query parameter, left out where it is not given';

const heldDollar =
  'Holds a $, which a value an entry places never holds, since a reference to an environment variable begins with it';

const account = { description: 'The account', pattern: '^[a-z]+$', example: 'acme' };

function siteDefinedAs(site: Readonly<Record<string, string>>) {
  return problemsOf({ ...tracker, placeholders: { site } });
}

function issuedBy(issuer: string) {
  return problemsOf({ ...ledgers, credentials: [{ kind: 'client_credentials', issuer }] });
}

function choice(value: string, sets: Readonly<Record<string, string>>) {
  return { value, title: value, sets };
}

describe('the fields of an entry', () => {
  it('are taken whole by the entries of every type', () => {
    expect([tracker, ledgers, regions].map((entry) => problemsOf(entry))).toEqual([[], [], []]);
  });

  it('refuse a name a tool server could not take, a page that is not https and a description past 300 characters', () => {
    expect(problemsOf({ ...tracker, description: 'a'.repeat(301) })).toEqual([
      ['/description', 'Expected a value with a length of at most 300'],
    ]);
    expect(problemsOf({ ...tracker, name: 'Tracker', website: 'http://developer.tracker.example.com' })).toEqual([
      ['/name', 'Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter'],
      ['/website', 'Expected the https URL of the page a person reads about the server'],
    ]);
  });
});

describe('the address of an entry', () => {
  it('is the one of its type, and none of another', () => {
    const unaddressed = Object.fromEntries(
      Object.entries(tracker).filter(([field]: readonly [string, unknown]) => field !== 'url'),
    );

    expect(problemsOf({ ...unaddressed, document: 'https://tracker.example.com/openapi.json' })).toEqual([
      ['/url', 'Expected url, which an mcp provider takes'],
      ['/document', 'Expected no document: an mcp provider takes url'],
      ['/placeholders/site', unplaced],
    ]);
    expect(problemsOf({ ...ledgers, url: 'https://ledgers.example.com/mcp' })).toEqual([
      ['/url', 'Expected no url: an openapi provider takes document'],
    ]);
  });

  it('refuses a stdio server, an address that is not https and a value that looks like a credential', () => {
    expect(problemsOf({ ...tracker, type: 'stdio' })).toMatchObject([['/type', expect.any(String)]]);
    expect(
      problemsOf({
        ...tracker,
        url: 'http://{site}.tracker.example.com/mcp',
        headers: { Authorization: 'Bearer ghp_0123456789abcdefghijklmnopqrstuv' },
      }),
    ).toEqual([
      ['/url', placesOtherwise],
      ['/headers/Authorization', heldCredential],
    ]);
  });
});

describe('the ways of an entry', () => {
  it('each take the fields of their kind and no other', () => {
    const ways = [
      { kind: 'secret', in: 'header' },
      { kind: 'none', issuer: 'https://auth.tracker.example.com' },
    ];

    expect(problemsOf({ ...tracker, credentials: ways })).toEqual([
      ['/credentials/0/name', 'Expected name, which a secret way takes'],
      ['/credentials/1/issuer', 'Expected no issuer: a none way takes no other field but its description'],
    ]);
    expect(problemsOf({ ...ledgers, credentials: [{ kind: 'client_credentials', in: 'header' }] })).toEqual([
      ['/credentials/0/in', 'Expected no in: a client_credentials way takes issuer, scope, and says'],
      ['/credentials/0/issuer', 'Expected issuer, which a client_credentials way takes'],
    ]);
  });

  it('are at least one, and of one kind each, or told apart by the scopes each asks', () => {
    const [consent] = drive.credentials;
    const readingAlone = { ...consent, scope: 'files.read', says: { 'files.read': 'Read the files of the account.' } };
    const reordered = { ...consent, scope: 'files.write files.read' };
    const noneTwice =
      'Expected a kind no other way has, since a none way asks no scope by which a caller would tell two apart';
    const scopeTwice =
      'Expected a scope no other authorization way asks, by which a caller tells two ways of one kind apart';

    expect(problemsOf({ ...tracker, credentials: [] })).toMatchObject([['/credentials', expect.any(String)]]);
    expect(problemsOf({ ...tracker, credentials: [{ kind: 'none' }, { kind: 'none', description: 'Again' }] })).toEqual(
      [['/credentials/1/kind', noneTwice]],
    );
    expect(problemsOf({ ...drive, credentials: [consent, readingAlone] })).toEqual([]);
    expect(problemsOf({ ...drive, credentials: [consent, readingAlone, reordered] })).toEqual([
      ['/credentials/2/scope', scopeTwice],
    ]);
  });
});

describe('the placeholders an entry places', () => {
  it('are each one it declares or a choice sets, and each it declares or a choice sets is placed', () => {
    expect(problemsOf({ ...tracker, url: 'https://{team}.tracker.example.com/mcp' })).toEqual([
      ['/url', 'Holds {team}, which no placeholder of the provider and no choice of one gives'],
      ['/placeholders/site', unplaced],
    ]);
    expect(problemsOf({ ...regions, base_url: 'https://api.regions.example.com/v1' })).toEqual([
      ['/placeholders', setAndDeclared],
    ]);
  });

  it('never declare a name a choice sets, nor client_id, nor a name of another form', () => {
    const named = { ...regions.placeholders, client_id: account, Site: account };

    expect(problemsOf({ ...regions, placeholders: named })).toEqual([
      [
        '/placeholders/client_id',
        'Expected another name: {client_id} is the client id of a client_credentials or authorization way, never asked',
      ],
      [
        '/placeholders/Site',
        'Expected the name of a placeholder: a lowercase letter, then lowercase letters, digits and underscores',
      ],
      ['/placeholders/client_id', unplaced],
      ['/placeholders/Site', unplaced],
    ]);
    expect(problemsOf({ ...regions, placeholders: { ...regions.placeholders, api_host: account } })).toEqual([
      ['/placeholders', setAndDeclared],
    ]);
  });
});

describe('the placeholders an entry places where only some may stand', () => {
  it('place an optional one as the whole value of a header or a query parameter alone, and {client_id} in a value', () => {
    expect(
      problemsOf({
        ...ledgers,
        base_url: 'https://api.ledgers.example.com/{tenant}/{client_id}/{manager}',
        headers: { 'X-Manager': 'manager {manager}' },
      }),
    ).toEqual([
      ['/base_url', clientIdElsewhere],
      ['/base_url', optionalElsewhere],
      ['/headers/X-Manager', optionalElsewhere],
    ]);
  });

  it('hold {client_id} only where every way of the provider is client_credentials or authorization', () => {
    const client = { 'X-Client': '{client_id}' };

    expect([
      problemsOf({ ...tracker, headers: client }),
      problemsOf({ ...adverts, headers: client }),
      problemsOf({ ...drive, headers: client }),
      problemsOf(audiences),
    ]).toEqual([[['/headers/X-Client', clientIdElsewhere]], [['/headers/X-Client', clientIdElsewhere]], [], []]);
  });
});

describe('the references an entry holds', () => {
  it('stand in a header or a query value alone, as references to a variable', () => {
    expect(
      problemsOf({
        ...regions,
        base_url: 'https://{api_host}/${REGIONS_PATH}',
        headers: { 'X-Developer-Token': '${REGIONS_TOKEN}', 'X-Broken': '${not a reference}' },
      }),
    ).toEqual([
      [
        '/headers/X-Broken',
        'Holds a ${…} that is not a reference to an environment variable; write ${NAME}, or $$ for a literal $',
      ],
      [
        '/base_url',
        "Holds a reference, which only a header or a query value of a provider's entry holds, for a value whoever runs Auto sets",
      ],
    ]);
  });
});

describe('the definition of a placeholder', () => {
  it('takes a pattern anchored at both ends and an example it matches', () => {
    expect([
      siteDefinedAs({ description: 'The site' }),
      siteDefinedAs({ description: 'The site', pattern: '^[a-z]+$' }),
      siteDefinedAs({ description: 'The site', example: 'acme' }),
      siteDefinedAs({ description: 'The site', pattern: '[a-z]+', example: 'acme' }),
      siteDefinedAs({ description: 'The site', pattern: '^[a-z+$', example: 'acme' }),
      siteDefinedAs({ description: 'The site', pattern: '^[0-9]+$', example: 'acme' }),
      siteDefinedAs({ description: 'The site', pattern: '^.+$', example: 'sk-live-0123456789abcdefghij' }),
    ]).toEqual([
      [
        ['/placeholders/site/pattern', 'Expected pattern, or choices'],
        ['/placeholders/site/example', 'Expected example, or choices'],
      ],
      [['/placeholders/site/example', 'Expected example, or choices']],
      [['/placeholders/site/pattern', 'Expected pattern, or choices']],
      [['/placeholders/site/pattern', 'Expected a regular expression anchored with ^ and $']],
      [['/placeholders/site/pattern', 'Expected a regular expression anchored with ^ and $']],
      [['/placeholders/site/example', 'Expected an example that matches ^[0-9]+$']],
      [['/placeholders/site/example', heldCredential]],
    ]);
  });

  it('of choices takes no pattern, example or required, a value no other choice has, and the names the first sets', () => {
    const region = {
      description: 'The region',
      required: true,
      choices: [choice('na', { api_host: 'a.example.com' }), choice('na', { api_host: 'b.example.com', zone: 'b' })],
    };

    expect(problemsOf({ ...regions, placeholders: { ...regions.placeholders, region } })).toEqual([
      [
        '/placeholders/region/required',
        'Expected no required: a placeholder of choices takes a description and its choices',
      ],
      ['/placeholders/region/choices/1/value', 'Expected a value no other choice has'],
      ['/placeholders/region/choices/1/sets', 'Expected the names the first choice sets, each choice setting the same'],
    ]);
  });

  it('of choices places no $ by a value or by what a choice sets, since a reference begins with it', () => {
    const region = { description: 'The region', choices: [choice('na$', { api_host: 'api.example.com/${PATH}' })] };

    expect(problemsOf({ ...regions, placeholders: { ...regions.placeholders, region } })).toEqual([
      ['/placeholders/region/choices/0/value', heldDollar],
      ['/placeholders/region/choices/0/sets/api_host', heldDollar],
    ]);
  });
});

describe('the issuer of a way of client credentials', () => {
  it('holds a placeholder the entry declares, in an https URL, and never a reference', () => {
    expect([
      issuedBy('https://auth.ledgers.example.com/{tenant}'),
      issuedBy('https://auth.ledgers.example.com/{realm}'),
      issuedBy('http://auth.ledgers.example.com/{tenant}'),
      issuedBy('https://auth.ledgers.example.com/${LEDGERS_REALM}'),
    ]).toEqual([
      [],
      [['/credentials/0/issuer', 'Holds {realm}, which no placeholder of the provider and no choice of one gives']],
      [['/credentials/0/issuer', placesOtherwise]],
      [
        [
          '/credentials/0/issuer',
          "Holds a reference, which only a header or a query value of a provider's entry holds, for a value whoever runs Auto sets",
        ],
      ],
    ]);
  });
});
