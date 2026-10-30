import type { ColorDepth } from '../logging/terminal.ts';

export type PaintingDepth = Exclude<ColorDepth, 1>;

interface Ink {
  readonly rgb: string;
  readonly indexed: number;
  readonly basic: number;
}

const inks: Readonly<Record<string, Ink>> = {
  W: { rgb: '255;255;255', indexed: 231, basic: 97 },
  K: { rgb: '26;26;26', indexed: 234, basic: 30 },
  r: { rgb: '236;63;74', indexed: 203, basic: 91 },
  o: { rgb: '255;138;29', indexed: 208, basic: 33 },
  g: { rgb: '94;199;45', indexed: 76, basic: 92 },
  b: { rgb: '66;195;247', indexed: 81, basic: 96 },
};

const foregrounds: Readonly<Record<PaintingDepth, (ink: Ink) => string>> = {
  24: ({ rgb }) => `38;2;${rgb}`,
  8: ({ indexed }) => `38;5;${indexed}`,
  4: ({ basic }) => String(basic),
};

const backgrounds: Readonly<Record<PaintingDepth, (ink: Ink) => string>> = {
  24: ({ rgb }) => `48;2;${rgb}`,
  8: ({ indexed }) => `48;5;${indexed}`,
  4: ({ basic }) => String(basic + 10),
};

const pixelRows: readonly (readonly [string, string])[] = [
  ['.............rr.oo.gg.bb', '............rr.oo.gg.bb.'],
  ['............rr.oo.gg.bb.', '......WWWWWWWWWWWWg.bb..'],
  ['.....WWWKWWWWKKKKKWbb...', '.....WWKKKWWWKKKKKWbb...'],
  ['.....WWKKKWWWKKKKKWb....', '.....WKKKKKWWKKKKKW.....'],
  ['.....WKKKKKWWWKKKWW.....', '.....WWWWWWWWWWWWWW.....'],
  ['.....WWWWWWWWWWWWWW.....', '.....WKKKKKWWWKKKWW.....'],
  ['.....WKKKKKWWKKKKKW.....', '....rWWKKKWWWKKKKKW.....'],
  ['...rrWWKKKWWWKKKKKW.....', '...rrWWKKKWWWWKKKWW.....'],
  ['..rr.oWWWWWWWWWWWW......', '.rr.oo.gg.bb............'],
  ['.rr.oo.gg.bb............', 'rr.oo.gg.bb.............'],
];

export const logoWidth = 24;

export const logoHeight = pixelRows.length;

function painted(codes: string, block: string): string {
  return `\u001B[${codes}m${block}\u001B[0m`;
}

function cellOf(top: string, bottom: string, depth: PaintingDepth): string {
  const above = inks[top];
  const below = inks[bottom];
  if (above === undefined) {
    return below === undefined ? ' ' : painted(foregrounds[depth](below), '▄');
  }
  if (below === undefined) {
    return painted(foregrounds[depth](above), '▀');
  }
  return top === bottom
    ? painted(foregrounds[depth](above), '█')
    : painted(`${foregrounds[depth](above)};${backgrounds[depth](below)}`, '▀');
}

export function logoLines(depth: PaintingDepth): readonly string[] {
  return pixelRows.map(([top, bottom]) =>
    Array.from({ length: top.length }, (_, column) => cellOf(top.charAt(column), bottom.charAt(column), depth)).join(
      '',
    ),
  );
}
