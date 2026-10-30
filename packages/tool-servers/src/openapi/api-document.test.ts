import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { decodedDocument } from './api-document.ts';

const notOfThisVersion = [{ pointer: '/openapi', detail: 'Expected an OpenAPI document of version 3.0 or 3.1' }];

describe('the version of an OpenAPI document', () => {
  it('is 3.0 or 3.1, read from its openapi field', () => {
    expect(Result.map(decodedDocument({ openapi: '3.0.0' }), ({ version }) => version)).toEqual(Result.succeed('3.0'));
    expect(Result.map(decodedDocument({ openapi: '3.1.1' }), ({ version }) => version)).toEqual(Result.succeed('3.1'));
  });

  it('is refused when the document does not say it, or says another', () => {
    expect(decodedDocument({ paths: {} })).toEqual(Result.fail(notOfThisVersion));
    expect(decodedDocument({ openapi: 3.1 })).toEqual(Result.fail(notOfThisVersion));
    expect(decodedDocument({ openapi: '3.2.0' })).toEqual(Result.fail(notOfThisVersion));
    expect(decodedDocument('openapi: 3.1.0')).toEqual(Result.fail(notOfThisVersion));
  });
});
