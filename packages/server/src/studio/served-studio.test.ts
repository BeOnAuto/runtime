import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ApiStudio, StudioHost } from '@on.auto/api';
import { Function } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { fakeStudioHost, studioScript } from '../testing/studios/fake-studio-host.ts';
import { markerName } from './kept-answers.ts';
import { reachingOnly, servedStudioOf, studioFolderName } from './served-studio.ts';

const serving = { report: Function.constVoid };

function aLedger(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(() => {
    ledger.remove();
  });
  return ledger;
}

function hostOf(studio: ApiStudio): StudioHost {
  if (!studio.served) {
    throw new Error('The runtime serves no Studio');
  }
  return studio.host;
}

describe('the Studio a runtime serves', () => {
  it('is none where its settings serve none', () => {
    const studio = { origin: 'https://studio.example.com', served: false };

    expect(servedStudioOf({ studio, ledger: { store: 'sqlite', file: ':memory:' } }, serving)).toEqual({
      origin: 'https://studio.example.com',
      served: false,
    });
    expect(() => hostOf(servedStudioOf({ studio, ledger: { store: 'sqlite', file: ':memory:' } }, serving))).toThrow(
      'The runtime serves no Studio',
    );
  });

  it('is fetched from the Studio host, and what it keeps is kept in a folder of its own beside the ledger file', async () => {
    const host = await fakeStudioHost();
    onTestFinished(() => host.close());
    const ledger = aLedger();
    const studio = { origin: host.origin, served: true };

    const answer = await hostOf(
      servedStudioOf({ studio, ledger: { store: 'sqlite', file: ledger.fileName } }, serving),
    )('/assets/index-4f2a9c.js');

    expect([answer?.status, answer?.contentType, new TextDecoder().decode(answer?.body)]).toEqual([
      200,
      'text/javascript',
      studioScript,
    ]);
    expect(readdirSync(join(ledger.directory, studioFolderName))).toContain(markerName);
    expect(readdirSync(join(ledger.directory, studioFolderName))).toHaveLength(2);
  });

  it('answers what the Studio host answers but does not keep, and nothing when the host is gone and nothing was kept', async () => {
    const host = await fakeStudioHost();
    const ask = hostOf(
      servedStudioOf(
        { studio: { origin: host.origin, served: true }, ledger: { store: 'sqlite', file: ':memory:' } },
        serving,
      ),
    );

    const missing = await ask('/assets/gone-0d1e2f.js');
    await host.close();
    const unreached = await ask('/settings');

    expect([missing?.status, unreached]).toEqual([404, undefined]);
  });
});

describe('the fetch a runtime reaches the Studio host with', () => {
  it('reaches the Studio host alone', () => {
    const reaches = reachingOnly('https://studio.example.com');

    expect([
      reaches('https://studio.example.com/assets/index.js'),
      reaches('https://elsewhere.example/assets/index.js'),
    ]).toEqual([undefined, 'Studio is fetched from https://studio.example.com alone']);
  });
});
