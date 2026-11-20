import { describe, expect, it } from 'vitest';

import { problemsOf, refusedAt } from '../testing/entry-problems.ts';
import { appLevelToken } from '../testing/event-destinations.ts';
import { drive } from '../testing/fixture-providers.ts';

const [consent] = drive.credentials;
const step = { title: 'Make a token at Tracker', instructions: 'Select **New token**, then copy it.' };

describe('the title of the key page of a way of a key', () => {
  it('is taken on a way of a key alone, in 1 to 40 characters', () => {
    expect([
      refusedAt({ key_page_title: 'Create your Tracker app' }),
      refusedAt({ key_page_title: 'a'.repeat(40) }),
      refusedAt({ key_page_title: '' }),
      refusedAt({ key_page_title: 'a'.repeat(41) }),
      problemsOf({ ...drive, credentials: [{ ...consent, key_page_title: 'Sign in' }] }).map(([path]) => path),
    ]).toEqual([
      [],
      [],
      ['/credentials/0/key_page_title'],
      ['/credentials/0/key_page_title'],
      ['/credentials/0/key_page_title'],
    ]);
  });
});

describe('the steps of a way of a key', () => {
  it('are taken on a way of a key alone, each a title of 1 to 60 characters and its instructions', () => {
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
      ['/credentials/0/steps'],
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
