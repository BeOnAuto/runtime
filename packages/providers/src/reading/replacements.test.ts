import { describe, expect, it } from 'vitest';

import { replacementOf } from '../index.ts';
import { drive, messages, providerListOf, providerOf } from '../testing/fixture-providers.ts';

const replacingDrive = providerOf({ ...messages, replaces: ['drive'] });

describe('the replacement of a provider', () => {
  it('is the provider of the list whose entry names it among those it replaces', () => {
    const list = providerListOf(providerOf(drive), replacingDrive);

    expect(replacementOf(list, 'drive')).toBe(replacingDrive);
  });

  it('is none for a provider no entry of the list replaces, for one the list does not hold, and for a server given by hand', () => {
    expect(replacementOf(providerListOf(providerOf(drive), providerOf(messages)), 'drive')).toBeUndefined();
    expect(replacementOf(providerListOf(replacingDrive), 'messages')).toBeUndefined();
    expect(replacementOf(providerListOf(replacingDrive), null)).toBeUndefined();
  });
});
