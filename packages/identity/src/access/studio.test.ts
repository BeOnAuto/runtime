import { describe, expect, it } from 'vitest';

import { defaultStudioOrigin, pageOriginsOf, studioBaseOf } from '../index.ts';

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
