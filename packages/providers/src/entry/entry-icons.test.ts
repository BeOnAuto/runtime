import { describe, expect, it } from 'vitest';

import { iconTypeOf, listedIconOf, mostIconBytes } from './entry-icons.ts';

const encoded = (text: string) => new TextEncoder().encode(text);

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);

const webp = encoded('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');

const wave = encoded('RIFF\u0000\u0000\u0000\u0000WAVEfmt ');

const svgOpen = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">';

const aPath = '<path fill="#1A2B3C" d="M12 .297c-6.63 0-12 5.373-12 12z"/>';

describe('the type of an icon', () => {
  it.each([
    ['a PNG', png, 'image/png'],
    ['a JPEG', jpeg, 'image/jpeg'],
    ['a WebP', webp, 'image/webp'],
    ['an SVG of one path, ending in a newline', encoded(`${svgOpen}${aPath}</svg>\n`), 'image/svg+xml'],
    [
      'an SVG of two paths in a box of its own',
      encoded(`${svgOpen.replace('0 0 24 24', '-1 0 66.5 68')}${aPath}${aPath}</svg>`),
      'image/svg+xml',
    ],
  ])('is read from the bytes of %s', (_, bytes: Readonly<Uint8Array>, type) => {
    expect(iconTypeOf(bytes)).toBe(type);
  });

  it.each([
    ['nothing', new Uint8Array()],
    ['a RIFF file that is no WebP', wave],
    ['an SVG with a script', encoded(`${svgOpen}<script>alert(1)</script>${aPath}</svg>`)],
    [
      'an SVG whose root has an attribute of its own',
      encoded(`${svgOpen.replace('>', ' onload="alert(1)">')}${aPath}</svg>`),
    ],
    ['an SVG with a link around its path', encoded(`${svgOpen}<a href="https://example.com">${aPath}</a></svg>`)],
    ['an SVG of no path', encoded(`${svgOpen}</svg>`)],
    ['an SVG whose fill is no colour', encoded(`${svgOpen}${aPath.replace('#1A2B3C', 'url(#a)')}</svg>`)],
    ['bytes that are not UTF-8', new Uint8Array([0xff, 0xfe, 0x3c, 0x73])],
  ])('is none for %s', (_, bytes: Readonly<Uint8Array>) => {
    expect(iconTypeOf(bytes)).toBeUndefined();
  });

  it('is none past the most bytes an icon may have, 16 KiB unless another most is given', () => {
    expect([iconTypeOf(png, png.length), iconTypeOf(png, png.length - 1)]).toEqual(['image/png', undefined]);
    expect(mostIconBytes).toBe(16_384);
  });
});

describe('a listed icon', () => {
  it('is the bytes as a data URI of their type, with the sizes and the theme its entry gives, and only those', () => {
    expect([
      listedIconOf({ src: 'icons/mark.png', sizes: ['48x48'], theme: 'dark' }, 'image/png', png),
      listedIconOf({ src: 'icons/mark.jpg' }, 'image/jpeg', jpeg),
    ]).toEqual([
      { src: 'data:image/png;base64,iVBORw0KGgoAAA==', mimeType: 'image/png', sizes: ['48x48'], theme: 'dark' },
      { src: 'data:image/jpeg;base64,/9j/4AA=', mimeType: 'image/jpeg' },
    ]);
  });
});
