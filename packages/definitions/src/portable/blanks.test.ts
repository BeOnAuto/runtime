import { stringFormats } from '@on.auto/json-schema';
import { describe, expect, it } from 'vitest';

import { BLANK_NAME, blankFor, blankPlacesIn, blankSpansIn, blanksStanding, lineAt } from './blanks.ts';

describe('a blank', () => {
  it('is named in capitals, digits and underscores, two to forty long', () => {
    expect(['OWNER_EMAIL', 'A1', 'X'.repeat(40)].every((name) => BLANK_NAME.test(name))).toBe(true);
    expect(['A', 'owner', '1A', 'X'.repeat(41), 'A-B'].some((name) => BLANK_NAME.test(name))).toBe(false);
  });

  it('is written in the shape of what it replaces', () => {
    expect(blankFor({ class: 'address', value: 'owner@example.com' }, 'OWNER_EMAIL')).toBe(
      'owner_email@owner_email.blank.invalid',
    );
    expect(blankFor({ class: 'address', value: 'https://shop.example.com/a' }, 'SHOP')).toBe(
      'https://shop.blank.invalid/',
    );
    expect(blankFor({ class: 'address', value: 'https://someone@shop.example.com' }, 'SHOP')).toBe(
      'https://shop.blank.invalid/',
    );
    expect(blankFor({ class: 'address', value: String.raw`https:\/\/shop.example.com\/a` }, 'SHOP')).toBe(
      'https://shop.blank.invalid/',
    );
    expect(blankFor({ class: 'address', value: 'shop.example.com' }, 'SHOP')).toBe('shop.blank.invalid');
    expect(blankFor({ class: 'id', value: 'C04ABC12DE' }, 'NEWS_CHANNEL')).toBe('AUTO_BLANK_NEWS_CHANNEL');
    expect(blankFor({ class: 'handle', value: '#news' }, 'NEWS')).toBe('AUTO_BLANK_NEWS');
  });

  it('in place of a URL or its host, still holds the URI format a save checks', () => {
    const url = blankFor({ class: 'address', value: 'https://shop.example.com/a' }, 'SHOP_SITE');
    const host = blankFor({ class: 'address', value: 'shop.example.com' }, 'SHOP_SITE');
    expect([url, `https://${host}/errors/late`].every((written) => stringFormats.uri.holds(written))).toBe(true);
    expect(stringFormats.email.holds(blankFor({ class: 'address', value: 'owner@example.com' }, 'OWNER'))).toBe(true);
  });
});

describe('a blank that still stands', () => {
  it('is found where it still stands, in each of its shapes, with its line', () => {
    const text = [
      'channel: AUTO_BLANK_NEWS_CHANNEL',
      'to: owner@owner.blank.invalid',
      'url: https://shop.blank.invalid/orders and mail.shop.blank.invalid',
      'not: XAUTO_BLANK_NEWS, AUTO_BLANK_n, shop.blank.invalidity, shop.blank.invalid.example.com',
    ].join('\n');
    expect(blankPlacesIn(text)).toEqual([
      { name: 'NEWS_CHANNEL', line: 1 },
      { name: 'OWNER', line: 2 },
      { name: 'SHOP', line: 3 },
      { name: 'SHOP', line: 3 },
    ]);
    expect(blankSpansIn('to AUTO_BLANK_AB.')).toEqual([{ name: 'AB', from: 3, to: 16 }]);
  });

  it('is listed by name with every place it stands in the texts', () => {
    expect(
      blanksStanding([
        { part: 'goals', text: 'AUTO_BLANK_TEAM' },
        {
          part: 'definition',
          name: 'lookup/read',
          field: 'source',
          text: 'AUTO_BLANK_TEAM AUTO_BLANK_TEAM\nteam.blank.invalid',
        },
        { part: 'page', text: 'nothing here' },
      ]),
    ).toEqual([
      {
        name: 'TEAM',
        occurrences: [
          { part: 'goals', line: 1 },
          { part: 'definition', name: 'lookup/read', field: 'source', line: 1 },
          { part: 'definition', name: 'lookup/read', field: 'source', line: 2 },
        ],
      },
    ]);
  });

  it('counts lines from one', () => {
    expect(lineAt('a\nb\nc', 4)).toBe(3);
  });
});
