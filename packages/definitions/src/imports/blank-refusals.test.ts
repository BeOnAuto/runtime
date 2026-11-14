import { Conflict } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { blankRefusalOf, blankRefusalWhere } from './blank-refusals.ts';

const blanked = ['channel: AUTO_BLANK_CHANNEL', 'to: owner@owner.blank.invalid', 'again: AUTO_BLANK_CHANNEL'].join(
  '\n',
);

describe('the refusal of a source that still holds a blank', () => {
  it('asks the person for the first blank, by its name and line, and counts the other blanks once each', () => {
    expect(blankRefusalOf(blanked, 'create')?.detail).toBe(
      'Ask the person: What is the value of the blank CHANNEL? The source still holds it on line 1, and one more blank; write the value in its place before you create it',
    );
    expect(blankRefusalOf(`${blanked}\nhost: https://shop.blank.invalid/`, 'update')?.detail).toBe(
      'Ask the person: What is the value of the blank CHANNEL? The source still holds it on line 1, and 2 more blanks; write the value in its place before you save it, because an active definition cannot keep a blank',
    );
    expect(blankRefusalOf('first line\nkey: AUTO_BLANK_KEY', 'resume')?.detail).toBe(
      'Ask the person: What is the value of the blank KEY? The source still holds it on line 2; write the value in its place with update_definition before you resume it',
    );
  });

  it('names the blank of an address by its name, as a request whose to still holds it is refused', () => {
    expect(blankRefusalOf('---\nto: owner_email@owner_email.blank.invalid\n---\nAsk.\n', 'resume')?.detail).toBe(
      'Ask the person: What is the value of the blank OWNER_EMAIL? The source still holds it on line 2; write the value in its place with update_definition before you resume it',
    );
  });

  it('is a conflict whose words fit in 256 bytes for the longest name a blank takes', () => {
    const refusal = blankRefusalOf(
      `${'\n'.repeat(99_998)}AUTO_BLANK_${'A'.repeat(40)} AUTO_BLANK_BB AUTO_BLANK_CC`,
      'resume',
    );

    expect(refusal).toBeInstanceOf(Conflict);
    expect(new TextEncoder().encode(refusal?.detail).length).toBeLessThanOrEqual(256);
  });

  it('refuses nothing in a source with no blank, nor where blanks are not refused', () => {
    expect([
      blankRefusalOf('channel: C04ABC12DE', 'create'),
      blankRefusalWhere(false, { source: blanked }, 'create'),
      blankRefusalWhere(undefined, { source: blanked }, 'create'),
      blankRefusalWhere(true, { source: blanked }, 'create')?.detail.startsWith('Ask the person:'),
    ]).toEqual([undefined, undefined, undefined, true]);
  });

  it('reads the source as it is recorded, inline or as the text the record keeps in its place', () => {
    expect([
      blankRefusalWhere(true, { source: { inline: blanked } }, 'resume')?.detail.startsWith('Ask the person:'),
      blankRefusalWhere(true, { source: { kept: { sha256: 'a'.repeat(64), bytes: 64 } } }, 'resume'),
      blankRefusalWhere(true, {}, 'update'),
    ]).toEqual([true, undefined, undefined]);
  });
});
