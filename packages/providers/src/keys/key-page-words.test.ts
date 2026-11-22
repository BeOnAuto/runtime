import { describe, expect, it } from 'vitest';

import { problemsOf, refusedAt } from '../testing/entry-problems.ts';
import { appLevelToken } from '../testing/event-destinations.ts';
import { drive } from '../testing/fixture-providers.ts';

const [consent] = drive.credentials;
const step = { title: 'Make a token at Tracker', instructions: 'Select **New token**, then copy it.' };

describe('the title of the key page of a way of a key', () => {
  it('is taken on a way of a key, and on a way of consent for the page of its own client, in 1 to 40 characters', () => {
    expect([
      refusedAt({ key_page_title: 'Create your Tracker app' }),
      refusedAt({ key_page_title: 'a'.repeat(40) }),
      refusedAt({ key_page_title: '' }),
      refusedAt({ key_page_title: 'a'.repeat(41) }),
      problemsOf({ ...drive, credentials: [{ ...consent, key_page_title: 'Sign in' }] }).map(([path]) => path),
    ]).toEqual([[], [], ['/credentials/0/key_page_title'], ['/credentials/0/key_page_title'], []]);
  });
});

describe('the steps of a way of a key', () => {
  it('are taken on a way of a key, and on a way of consent for its own client, each a title of 1 to 60 characters and its instructions', () => {
    expect([
      refusedAt({ steps: { key_page: step, key: step, connected: step } }),
      refusedAt({ steps: { key: { ...step, title: 'a'.repeat(60) } } }),
      refusedAt({ steps: { key: { ...step, title: '' } } }),
      refusedAt({ steps: { key: { ...step, title: 'a'.repeat(61) } } }),
      refusedAt({ steps: { connected: { title: step.title } } }),
      refusedAt({ steps: { key_page: { ...step, instructions: 'Open <a href="https://evil.example">it</a>.' } } }),
      problemsOf({ ...drive, credentials: [{ ...consent, steps: { key: step } }] }).map(([path]) => path),
    ]).toEqual([
      [],
      [],
      ['/credentials/0/steps/key/title'],
      ['/credentials/0/steps/key/title'],
      ['/credentials/0/steps/connected/instructions'],
      ['/credentials/0/steps/key_page/instructions'],
      [],
    ]);
  });
});

describe('the title of the step of an app credential', () => {
  it('is taken in 1 to 60 characters', () => {
    expect([
      refusedAt({ app_credentials: [{ ...appLevelToken, title: 'a'.repeat(60) }] }),
      refusedAt({ app_credentials: [{ ...appLevelToken, title: 'a'.repeat(61) }] }),
    ]).toEqual([[], ['/credentials/0/app_credentials/0/title']]);
  });
});

const pageStep = {
  title: 'Ask Drive for access',
  instructions: 'Apply for access to the API.',
  page: 'https://drive.example.com/access',
  page_title: 'Open the request form',
};

const madeAtTheProvider = {
  key_page: 'https://console.drive.example.com/clients',
  key_page_title: 'Open the clients of Drive',
  client_id_title: 'Application ID',
  steps: { key_page: step, pages: [pageStep], key: step },
};

function refusedOnConsent(way: Readonly<Record<string, unknown>>): readonly string[] {
  return problemsOf({ ...drive, credentials: [{ ...consent, ...way }] }).map(([path]) => path);
}

const limits: readonly (readonly [string, Readonly<Record<string, unknown>>, string])[] = [
  ['the label of the button', { key_page_title: 'x'.repeat(41) }, '/credentials/0/key_page_title'],
  ['the label of the client ID', { client_id_title: 'x'.repeat(41) }, '/credentials/0/client_id_title'],
  [
    'the heading of a step',
    { steps: { key_page: { ...step, title: 'x'.repeat(61) } } },
    '/credentials/0/steps/key_page/title',
  ],
  [
    'the paragraph of a step',
    { steps: { key: { ...step, instructions: 'x'.repeat(1001) } } },
    '/credentials/0/steps/key/instructions',
  ],
  [
    'the button of a step on another page',
    { steps: { pages: [{ ...pageStep, page_title: 'x'.repeat(41) }] } },
    '/credentials/0/steps/pages/0/page_title',
  ],
  ['the page where it is made', { key_page: 'http://console.drive.example.com/clients' }, '/credentials/0/key_page'],
];

describe('how the organization’s own OAuth client of a way of consent is made', () => {
  it('is said by the page where it is made, the label of its button, the label of the client ID and the steps', () => {
    expect([
      refusedOnConsent(madeAtTheProvider),
      refusedOnConsent({ ...madeAtTheProvider, oauth_client: 'required' }),
    ]).toEqual([[], []]);
  });

  it.each(limits)('keeps the limit of %s that a way of client credentials keeps', (_case, way, path) => {
    expect(refusedOnConsent(way)).toEqual([path]);
  });

  it('takes each label and each step at its limit', () => {
    const atTheLimit = {
      key_page_title: 'x'.repeat(40),
      client_id_title: 'x'.repeat(40),
      steps: { key_page: { title: 'x'.repeat(60), instructions: 'x'.repeat(1000) } },
    };

    expect(refusedOnConsent(atTheLimit)).toEqual([]);
  });
});
