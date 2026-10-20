import { describe, expect, it } from 'vitest';

import { defaultStudioOrigin, pageOriginsOf, studioBaseOf, studioLinkOf } from '../index.ts';

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
