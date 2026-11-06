const mostKeyPatternCharacters = 200;

const mostRepetitions = 1000;

const mostKeyCharactersMatched = 8192;

type Takes = (character: string) => boolean;

type Groups = Readonly<Record<string, string | undefined>>;

interface KeyPart {
  readonly takes: Takes;
  readonly fewest: number;
  readonly most: number;
}

type KeyPattern = readonly KeyPart[];

interface PartRead {
  readonly text: string;
  readonly groups: Groups;
}

interface Matched {
  readonly 0: string;
  readonly groups?: Readonly<Record<string, string>> | undefined;
}

const escapedAlone = String.raw`\\[\^$\\.*+?()[\]{}|/]`;

const escapedInAClass = String.raw`\\[dw\^$\\.*+?()[\]{}|/-]`;

const classOpening = String.raw`(?:[^\\\]^]|${escapedInAClass})`;

const classRest = String.raw`(?:[^\\\]]|${escapedInAClass})*`;

const atoms = [
  String.raw`\\[dw]`,
  escapedAlone,
  String.raw`\[(?<negated>\^)?(?<items>${classOpening}${classRest})\]`,
  String.raw`\.`,
  String.raw`[^\^$\\.*+?()[\]{}|]`,
];

const repeat = String.raw`(?<repeat>[?*+]|\{(?<fewest>\d+)(?<range>,(?<most>\d*))?\})`;

const part = new RegExp(`(?<atom>${atoms.join('|')})${repeat}?`, 'gu');

const classItem = /\\(?<shorthand>[dw])|(?<from>[^\\]|\\.)(?:-(?<to>[^\\]|\\.))?/gu;

const shorthandAtom = /^\\[dw]$/u;

const digits = '0123456789';

const shorthands: Readonly<Record<'d' | 'w', ReadonlySet<string>>> = {
  d: new Set(digits),
  w: new Set(`${digits}ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_`),
};

const lineTerminators: ReadonlySet<string> = new Set([
  '\n',
  '\r',
  String.fromCodePoint(0x20_28),
  String.fromCodePoint(0x20_29),
]);

const repeats: Readonly<Record<string, readonly [number, number]>> = {
  '?': [0, 1],
  '*': [0, Infinity],
  '+': [1, Infinity],
};

const keyPatternShape =
  'Expected a regular expression from ^ to $ of characters and character classes, such as [A-Za-z0-9], \\d, \\w and ., each repeated with ?, *, +, {n}, {n,} or {n,m}: a group, an alternative, a lookaround or a back reference is not taken, so that checking a key takes time in proportion to its length';

const tooLong = `Expected a pattern of at most ${mostKeyPatternCharacters} characters`;

const repeatedTooOften = `Expected repetitions of at most ${mostRepetitions.toLocaleString('en-US')}`;

function groupsOf({ groups }: Matched): Groups {
  return { ...groups };
}

function codePointOf(character: string): number {
  return Number(character.codePointAt(0));
}

function literalOf(written: string): string {
  return written.startsWith('\\') ? written.slice(1) : written;
}

function shorthandOf(letter: string): Takes {
  const taken = letter === 'd' ? shorthands.d : shorthands.w;
  return (character) => taken.has(character);
}

function rangeOf(from: string, to: string): Takes {
  const [low, high] = [codePointOf(literalOf(from)), codePointOf(literalOf(to))];
  return (character) => codePointOf(character) >= low && codePointOf(character) <= high;
}

function itemOf({ shorthand, from, to }: Groups): Takes {
  if (shorthand !== undefined) {
    return shorthandOf(shorthand);
  }
  const literal = literalOf(String(from));
  return to === undefined ? (character) => character === literal : rangeOf(String(from), to);
}

function classOf(items: string, negated: boolean): Takes {
  const taken = [...items.matchAll(classItem)].map((item: Matched) => itemOf(groupsOf(item)));
  return (character) => taken.some((takes) => takes(character)) !== negated;
}

function atomOf({ atom, items, negated }: Groups): Takes {
  const written = String(atom);
  if (items !== undefined) {
    return classOf(items, negated !== undefined);
  }
  if (written === '.') {
    return (character) => !lineTerminators.has(character);
  }
  if (shorthandAtom.test(written)) {
    return shorthandOf(written.slice(1));
  }
  const literal = literalOf(written);
  return (character) => character === literal;
}

function boundsOf({ repeat: repeated, fewest, range, most }: Groups): readonly [number, number] {
  if (fewest === undefined) {
    return repeats[String(repeated)] ?? [1, 1];
  }
  if (range === undefined) {
    return [Number(fewest), Number(fewest)];
  }
  return [Number(fewest), most === '' ? Infinity : Number(most)];
}

function keyPartOf({ groups }: PartRead): KeyPart {
  const [fewest, most] = boundsOf(groups);
  return { takes: atomOf(groups), fewest, most };
}

function partsOf(body: string): readonly PartRead[] {
  return [...body.matchAll(part)].map((read: Matched) => ({ text: read[0], groups: groupsOf(read) }));
}

function isARegularExpression(pattern: string): boolean {
  try {
    return new RegExp(pattern, 'u').unicode;
  } catch {
    return false;
  }
}

function isRepeatedTooOften({ groups }: PartRead): boolean {
  return Number(groups['fewest']) > mostRepetitions || Number(groups['most']) > mostRepetitions;
}

function patternOfTheBody(pattern: string, body: string): KeyPattern | string {
  const parts = partsOf(body);
  if (parts.map(({ text }) => text).join('') !== body || !isARegularExpression(pattern)) {
    return keyPatternShape;
  }
  return parts.some((read) => isRepeatedTooOften(read)) ? repeatedTooOften : parts.map((read) => keyPartOf(read));
}

function readKeyPattern(pattern: string): KeyPattern | string {
  if (pattern.length > mostKeyPatternCharacters) {
    return tooLong;
  }
  const anchored = pattern.length > 1 && pattern.startsWith('^') && pattern.endsWith('$');
  return anchored ? patternOfTheBody(pattern, pattern.slice(1, -1)) : keyPatternShape;
}

export function keyPatternIssueOf(pattern: string): string | undefined {
  const read = readKeyPattern(pattern);
  return typeof read === 'string' ? read : undefined;
}

function runsOf(takes: Takes, characters: readonly string[]): Readonly<Uint32Array> {
  const runs = new Uint32Array(characters.length + 1);
  let run = 0;
  for (let at = characters.length - 1; at >= 0; at -= 1) {
    run = takes(String(characters[at])) ? run + 1 : 0;
    runs[at] = run;
  }
  return runs;
}

function reachedAfter(
  { takes, fewest, most }: KeyPart,
  characters: readonly string[],
  reached: Readonly<Uint8Array>,
): Readonly<Uint8Array> {
  const next = new Uint8Array(reached.length);
  let coveredUpTo = -1;
  for (const [at, run] of runsOf(takes, characters).entries()) {
    if (reached[at] === 1 && run >= fewest) {
      const last = at + Math.min(most, run);
      next.fill(1, Math.max(at + fewest, coveredUpTo + 1), last + 1);
      coveredUpTo = Math.max(coveredUpTo, last);
    }
  }
  return next;
}

function isMatchedBy(pattern: KeyPattern, characters: readonly string[]): boolean {
  const start = new Uint8Array(characters.length + 1);
  start[0] = 1;
  const reached = pattern.reduce<Readonly<Uint8Array>>(
    (before, keyPart) => reachedAfter(keyPart, characters, before),
    start,
  );
  return reached[characters.length] === 1;
}

export function matchesKeyPattern(pattern: string, value: string): boolean {
  const read = readKeyPattern(pattern);
  return typeof read !== 'string' && value.length <= mostKeyCharactersMatched && isMatchedBy(read, Array.from(value));
}
