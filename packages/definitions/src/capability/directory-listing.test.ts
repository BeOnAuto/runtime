import { DirectoryListing, NotFound } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  defineCapability,
  inTheDirectoryListing,
  operationsInTheDirectoryListing,
  operationsOfCapabilities,
} from '../index.ts';
import { echo, echoDeclaration } from '../testing/capabilities/echo.ts';
import { knownCapabilities } from './known-capabilities.ts';

const outside = defineCapability({ ...echoDeclaration, type: 'outside', outsideTheDirectoryListing: true });

const known = knownCapabilities([echo, outside]);

describe('a capability outside the directory listing', () => {
  it('is said so only where its declaration says so', () => {
    expect([echo.outsideTheDirectoryListing, outside.outsideTheDirectoryListing]).toEqual([undefined, true]);
  });

  it('is left out of the capabilities the directory listing serves', () => {
    expect(inTheDirectoryListing([echo, outside])).toEqual([echo]);
  });

  it('has the operations it serves beside its definitions left out of those the directory listing serves', () => {
    const served = [
      { capability: echo, operations: ['echo_back'] },
      { capability: outside, operations: ['get_outside', 'list_outside'] },
    ];

    expect([operationsOfCapabilities(served), operationsInTheDirectoryListing(served)]).toEqual([
      ['echo_back', 'get_outside', 'list_outside'],
      ['echo_back'],
    ]);
  });

  it('is not found in a call through the directory listing, and found in any other', () => {
    expect(Effect.runSync(known.capabilityOfType('outside'))).toBe(outside);
    expect(
      Effect.runSync(
        Effect.flip(known.capabilityOfType('outside').pipe(Effect.provideService(DirectoryListing, true))),
      ),
    ).toEqual(new NotFound({ detail: 'The directory listing keeps no definition type outside' }));
    expect(Effect.runSync(known.capabilityOfType('echo').pipe(Effect.provideService(DirectoryListing, true)))).toBe(
      echo,
    );
  });
});
