import { describe, expect, it } from 'vitest';

import { replacedNamesOf, replacementOf } from '../index.ts';
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

describe('the replacement of a provider that has other names', () => {
  const ownDrive = providerOf({ ...drive, aliases: ['files'] });

  it('is the provider whose entry replaces it by any of its names, asked by any of them', () => {
    const byItsOldName = providerOf({ ...messages, replaces: ['files'] });
    const byItsName = providerOf({ ...messages, replaces: ['drive'] });

    expect(
      [providerListOf(ownDrive, byItsOldName), providerListOf(ownDrive, byItsName)].flatMap((list) =>
        ['drive', 'files'].map((name) => replacementOf(list, name)?.entry.replaces),
      ),
    ).toEqual([['files'], ['files'], ['drive'], ['drive']]);
  });

  it('names each provider replaced once, by the name the list gives it now, and one the list does not hold as written', () => {
    const replacing = providerOf({ ...messages, replaces: ['files', 'drive', 'notes'] }).entry;

    expect(replacedNamesOf(providerListOf(ownDrive), replacing)).toEqual(['drive', 'notes']);
    expect(replacedNamesOf(providerListOf(ownDrive), messages)).toEqual([]);
  });
});

describe('a provider that replaces another, asked by another of its own names', () => {
  it('is the provider that replaces, and is replaced by none', () => {
    const relay = providerOf({ ...messages, aliases: ['relay'], replaces: ['drive'] });
    const list = providerListOf(providerOf(drive), relay);

    expect([replacementOf(list, 'drive'), replacementOf(list, 'relay'), replacementOf(list, 'messages')]).toEqual([
      relay,
      undefined,
      undefined,
    ]);
  });
});
