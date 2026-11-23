import { drive, ledgers, tracker } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { waysListedOf } from '../testing/listed-ways.ts';

const [aKey] = tracker.credentials;
const step = { title: 'Make a token at Tracker', instructions: 'Select **New token**, then copy it.' };
const words = { key_page_title: 'Create your Tracker token', steps: { key_page: step, connected: step } };

describe('a provider whose way is a key, as the page lists it', () => {
  it('gives the words that open its key page and the words of its steps exactly where its entry gives them', async () => {
    const [declared] = await waysListedOf({ ...tracker, credentials: [{ ...aKey, ...words }] });
    const [undeclared] = await waysListedOf(tracker);

    expect(declared).toMatchObject({ kind: 'secret', ...words });
    expect(undeclared).toMatchObject({ kind: 'secret' });
    expect(undeclared).not.toHaveProperty('key_page_title');
    expect(undeclared).not.toHaveProperty('steps');
  });

  it('gives the page, the words that open it and the steps of a way of client credentials where its entry gives them', async () => {
    const [client] = ledgers.credentials;
    const keyPage = 'https://app.ledgers.example.com/clients';
    const [declared] = await waysListedOf({ ...ledgers, credentials: [{ ...client, key_page: keyPage, ...words }] });

    expect(declared).toMatchObject({ kind: 'client_credentials', key_page: keyPage, ...words });
  });
});

describe('a provider whose way is a way of consent, as the page lists it', () => {
  it('gives the page where the organization’s own OAuth client is made, its labels, its steps and how long the provider keeps a refresh token, where its entry gives them', async () => {
    const [consent] = drive.credentials;
    const madeAtDrive = {
      key_page: 'https://console.drive.example.com/clients',
      client_id_title: 'Application ID',
      refresh_token_expires_in: 1_209_600,
      ...words,
    };
    const [declared] = await waysListedOf({ ...drive, credentials: [{ ...consent, ...madeAtDrive }] });
    const [undeclared] = await waysListedOf(drive);

    expect(declared).toMatchObject({ kind: 'authorization', ...madeAtDrive });
    expect(undeclared).toMatchObject({ kind: 'authorization' });
    expect(undeclared).not.toHaveProperty('key_page');
    expect(undeclared).not.toHaveProperty('client_id_title');
    expect(undeclared).not.toHaveProperty('steps');
    expect(undeclared).not.toHaveProperty('refresh_token_expires_in');
  });
});

describe('a provider whose way states what a connection made through it cannot do, as the page lists it', () => {
  it('gives that sentence where its entry states it, and none where its entry states none', async () => {
    const [client] = ledgers.credentials;
    const limitation = 'It can’t read the ledgers of another company.';
    const [declared] = await waysListedOf({ ...ledgers, credentials: [{ ...client, limitation }] });
    const [undeclared] = await waysListedOf(ledgers);

    expect(declared).toMatchObject({ kind: 'client_credentials', limitation });
    expect(undeclared).toMatchObject({ kind: 'client_credentials' });
    expect(undeclared).not.toHaveProperty('limitation');
  });
});
