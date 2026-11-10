import { describe, expect, it } from 'vitest';

import { canonicallyEqual } from '../runs/settlement-keys.ts';
import { keptArmOf } from '../testing/kept-payloads.ts';
import { comparedPayloads, keptToCompare } from './payload-comparisons.ts';

const leads = { region: 'emea', leads: Array.from({ length: 80 }, (_, index) => `lead-${index}`) };

const reordered = { leads: leads.leads, region: 'emea' };

const kept = keptArmOf(leads);

const another = keptArmOf({ scores: leads.leads });

describe('two payloads compared', () => {
  it('are compared by value when both are inline, as before', () => {
    expect([
      comparedPayloads({ inline: leads }, { inline: reordered }, canonicallyEqual),
      comparedPayloads({ inline: leads }, { inline: { region: 'apac' } }, canonicallyEqual),
    ]).toEqual(['same', 'different']);
  });

  it('are the same when the text of one is the digest the other was kept by, or both were kept by one digest', () => {
    expect([
      comparedPayloads({ kept }, { inline: leads }, canonicallyEqual),
      comparedPayloads({ inline: leads }, { kept }, canonicallyEqual),
      comparedPayloads({ kept }, { kept }, canonicallyEqual),
    ]).toEqual(['same', 'same', 'same']);
  });

  it('are unknown, never guessed equal or different, where a kept one meets other text', () => {
    expect([
      comparedPayloads({ kept }, { inline: reordered }, canonicallyEqual),
      comparedPayloads({ kept }, { kept: another }, canonicallyEqual),
    ]).toEqual(['unknown', 'unknown']);
  });
});

describe('two payloads compared with the values read of those kept outside', () => {
  it('are compared by value where every kept one was read, and unknown where one was not', () => {
    const read = new Map([[kept.sha256, leads]]);

    expect([
      comparedPayloads({ kept }, { inline: reordered }, canonicallyEqual, read),
      comparedPayloads({ kept }, { inline: { region: 'apac' } }, canonicallyEqual, read),
      comparedPayloads({ kept }, { kept: another }, canonicallyEqual, read),
    ]).toEqual(['same', 'different', 'unknown']);
  });

  it('need the values kept outside of a pair that cannot be told apart otherwise, and none for a pair that can', () => {
    expect([
      keptToCompare({ kept }, { inline: reordered }),
      keptToCompare({ kept }, { kept: another }),
      keptToCompare({ kept }, { inline: leads }),
      keptToCompare({ inline: leads }, { inline: { region: 'apac' } }),
    ]).toEqual([[kept], [kept, another], [], []]);
  });
});
