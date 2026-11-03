import type { StudioPage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { defaultStudioOrigin, pageOriginsOf, studioBaseOf, studioLinkOf, type StudioSettings } from '../index.ts';

const ownOrigin = 'http://127.0.0.1:5555';

const elsewhere = { origin: 'https://studio.example.com', served: false };

describe('the Studio a person can reach', () => {
  it('is the Studio the runtime serves under its own origin, when it serves one', () => {
    expect(studioBaseOf({ origin: defaultStudioOrigin, served: true }, ownOrigin)).toBe(
      'http://127.0.0.1:5555/studio/',
    );
  });

  it('is the root of the Studio host, when the runtime serves none', () => {
    expect([
      studioBaseOf({ origin: defaultStudioOrigin, served: false }, ownOrigin),
      studioBaseOf(elsewhere, ownOrigin),
    ]).toEqual(['https://studio.on.auto/', 'https://studio.example.com/']);
  });
});

describe('the link that opens Studio on the runtime', () => {
  it('names the runtime and where it was opened from', () => {
    expect([
      studioLinkOf(elsewhere, { ownOrigin, openedFrom: 'terminal', installId: undefined }),
      studioLinkOf({ ...elsewhere, served: true }, { ownOrigin, openedFrom: 'runtime-page', installId: undefined }),
    ]).toEqual([
      'https://studio.example.com/?server=http%3A%2F%2F127.0.0.1%3A5555&src=terminal',
      'http://127.0.0.1:5555/studio/?server=http%3A%2F%2F127.0.0.1%3A5555&src=runtime-page',
    ]);
  });

  it('names the install of the runtime too, where it has one', () => {
    expect(
      studioLinkOf(elsewhere, {
        ownOrigin,
        openedFrom: 'terminal',
        installId: '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b',
      }),
    ).toBe(
      'https://studio.example.com/?server=http%3A%2F%2F127.0.0.1%3A5555&src=terminal&install=6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b',
    );
  });
});

function atPage(studio: StudioSettings, page: StudioPage): string {
  return studioLinkOf(studio, { ownOrigin, openedFrom: 'agent', installId: undefined, page });
}

const atAlpha = 'https://studio.example.com/?server=http%3A%2F%2F127.0.0.1%3A5555&src=agent&playbook=alpha';

describe('the link that opens Studio on the runtime at a page', () => {
  it("names the playbook of the page, and a definition's type and name, why the link is given and the version, or its Ledger and a run's id", () => {
    expect([
      atPage(elsewhere, { kind: 'playbook', playbook: 'alpha' }),
      atPage(elsewhere, {
        kind: 'definition',
        playbook: 'alpha',
        type: 'workflow',
        name: 'weekly-build',
        version: 1,
        saved: 'created',
      }),
      atPage(elsewhere, { kind: 'run', playbook: 'alpha', run: '0190f5c2-run' }),
    ]).toEqual([
      atAlpha,
      `${atAlpha}&workflow=weekly-build&because=created&version=1`,
      `${atAlpha}&ledger=&run=0190f5c2-run`,
    ]);
  });

  it('names a reasoning function by its type, as every definition is named', () => {
    expect(
      atPage(
        { ...elsewhere, served: true },
        { kind: 'definition', playbook: 'alpha', type: 'reasoning', name: 'summary', version: 3, saved: 'updated' },
      ),
    ).toBe(
      'http://127.0.0.1:5555/studio/?server=http%3A%2F%2F127.0.0.1%3A5555&src=agent&playbook=alpha&reasoning=summary&because=updated&version=3',
    );
  });

  it("names a definition's version and no reason where the call saved nothing", () => {
    expect(
      atPage(elsewhere, { kind: 'definition', playbook: 'alpha', type: 'reasoning', name: 'summary', version: 2 }),
    ).toBe(`${atAlpha}&reasoning=summary&version=2`);
  });
});

describe('the link that opens Studio on the runtime at a comment', () => {
  const atAlphaOfAComment = 'https://studio.example.com/?server=http%3A%2F%2F127.0.0.1%3A5555&playbook=alpha';
  const comment = '019a4120-5b6c-7d8e-9f01-2a3b4c5d6e7f';
  const run = '019a4012-7c3e-7d10-9b2a-4e6f8a1c2d3e';

  it('names the runtime, the playbook, each part of what the comment is about that its address has, and the comment, and no arrival from an agent', () => {
    expect([
      atPage(elsewhere, { kind: 'comment', playbook: 'alpha', comment, on: { kind: 'playbook' } }),
      atPage(elsewhere, {
        kind: 'comment',
        playbook: 'alpha',
        comment,
        on: { kind: 'definition', type: 'workflow', name: 'close-the-week', version: 4 },
      }),
      atPage(elsewhere, { kind: 'comment', playbook: 'alpha', comment, on: { kind: 'run', run } }),
    ]).toEqual([
      `${atAlphaOfAComment}&comment=${comment}`,
      `${atAlphaOfAComment}&workflow=close-the-week&version=4&comment=${comment}`,
      `${atAlphaOfAComment}&ledger=&run=${run}&comment=${comment}`,
    ]);
  });

  it('names a step without its leading slash, URL-encoded, and the Ledger with the event or the block of a run', () => {
    expect([
      atPage(elsewhere, {
        kind: 'comment',
        playbook: 'alpha',
        comment,
        on: { kind: 'definition', type: 'workflow', name: 'close-the-week', version: 4, step: 'do/1/review' },
      }),
      atPage(elsewhere, { kind: 'comment', playbook: 'alpha', comment, on: { kind: 'run', run, event: `${run}_2` } }),
      atPage(elsewhere, { kind: 'comment', playbook: 'alpha', comment, on: { kind: 'run', run, block: 2 } }),
    ]).toEqual([
      `${atAlphaOfAComment}&workflow=close-the-week&version=4&step=do%2F1%2Freview&comment=${comment}`,
      `${atAlphaOfAComment}&ledger=&run=${run}&event=${run}_2&comment=${comment}`,
      `${atAlphaOfAComment}&ledger=&run=${run}&block=2&comment=${comment}`,
    ]);
    expect(
      studioLinkOf(elsewhere, {
        ownOrigin,
        openedFrom: 'agent',
        installId: '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b',
        page: { kind: 'comment', playbook: 'alpha', comment, on: { kind: 'playbook' } },
      }),
    ).toBe(`${atAlphaOfAComment}&comment=${comment}`);
  });
});

describe('the link that opens Studio on the runtime at a comment of the organization', () => {
  const atTheOrg = 'https://studio.example.com/?server=http%3A%2F%2F127.0.0.1%3A5555';
  const comment = '019a4131-9d2e-7f40-8a51-6b7c8d9e0f12';

  it('names no playbook: the comment alone for the organization, and the page of Settings for a thing on one', () => {
    expect([
      atPage(elsewhere, { kind: 'org_comment', comment }),
      atPage(elsewhere, { kind: 'org_comment', comment, settings: 'connections' }),
      studioLinkOf(elsewhere, {
        ownOrigin,
        openedFrom: 'agent',
        installId: '6f1c2b8e-3d4a-4e5f-9a0b-1c2d3e4f5a6b',
        page: { kind: 'org_comment', comment, settings: 'billing' },
      }),
    ]).toEqual([
      `${atTheOrg}&comment=${comment}`,
      `${atTheOrg}&settings=connections&comment=${comment}`,
      `${atTheOrg}&settings=billing&comment=${comment}`,
    ]);
  });
});

describe('the origins a page may call the runtime from', () => {
  it("are the Studio host's and the allowed origins, where the runtime serves no Studio", () => {
    expect(pageOriginsOf({ studio: elsewhere, allowedOrigins: ['https://app.example'] }, ownOrigin)).toEqual([
      'https://studio.example.com',
      'https://app.example',
    ]);
  });

  it("hold the runtime's own origin beside the Studio host's, where the runtime serves Studio", () => {
    expect(
      pageOriginsOf({ studio: { ...elsewhere, served: true }, allowedOrigins: ['https://app.example'] }, ownOrigin),
    ).toEqual(['https://studio.example.com', ownOrigin, 'https://app.example']);
  });
});
