type Expected = 'value' | 'value_or_close' | 'key_or_close' | 'key' | 'colon' | 'comma_or_close' | 'end';

type NumberPart = 'minus' | 'zero' | 'int' | 'dot' | 'fraction' | 'e' | 'exponent_sign' | 'exponent';

type Container = 'object' | 'array';

interface Stack {
  readonly top: Container;
  readonly below: Stack | undefined;
  readonly depth: number;
}

interface StringToken {
  readonly kind: 'string';
  readonly key: boolean;
  readonly escaped: boolean;
  readonly hexLeft: number;
}

interface NumberToken {
  readonly kind: 'number';
  readonly part: NumberPart;
}

interface LiteralToken {
  readonly kind: 'literal';
  readonly rest: string;
}

type Token = StringToken | NumberToken | LiteralToken;

interface Syntax {
  readonly expected: Expected;
  readonly token: Token | undefined;
  readonly stack: Stack | undefined;
  readonly mostDepth: number;
  readonly broken: boolean;
  readonly tooDeep: boolean;
}

export type JsonFound = 'one_value' | 'not_one_value' | 'too_deep';

export interface JsonSyntaxCheck {
  readonly take: (text: string) => void;
  readonly ended: () => JsonFound;
}

const whiteSpace: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r']);

const simpleEscapes: ReadonlySet<string> = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);

const hexDigit = /^[0-9a-f]$/iu;

const digit = /^[0-9]$/u;

const literals: Readonly<Record<string, string>> = { t: 'rue', f: 'alse', n: 'ull' };

const lastControl = 0x1f;

const numberEnds: ReadonlySet<NumberPart> = new Set(['zero', 'int', 'fraction', 'exponent']);

const exponentMarks: ReadonlySet<string> = new Set(['e', 'E']);

function isDigit(character: string): boolean {
  return digit.test(character);
}

function brokenAt(syntax: Syntax): Syntax {
  return { ...syntax, broken: true };
}

function afterValue(syntax: Syntax): Syntax {
  return { ...syntax, token: undefined, expected: syntax.stack === undefined ? 'end' : 'comma_or_close' };
}

function opened(syntax: Syntax, container: Container): Syntax {
  const depth = (syntax.stack?.depth ?? 0) + 1;
  if (depth > syntax.mostDepth) {
    return { ...brokenAt(syntax), tooDeep: true };
  }
  const expected = container === 'object' ? 'key_or_close' : 'value_or_close';
  return { ...syntax, stack: { top: container, below: syntax.stack, depth }, expected };
}

function closed(syntax: Syntax, container: Container): Syntax {
  const { stack } = syntax;
  return stack?.top === container ? afterValue({ ...syntax, stack: stack.below }) : brokenAt(syntax);
}

function numberStartOf(character: string): NumberPart {
  if (character === '-') {
    return 'minus';
  }
  return character === '0' ? 'zero' : 'int';
}

function scalarStarted(syntax: Syntax, character: string): Syntax {
  const literal = literals[character];
  if (character === '"') {
    return { ...syntax, token: { kind: 'string', key: false, escaped: false, hexLeft: 0 } };
  }
  if (character === '-' || isDigit(character)) {
    return { ...syntax, token: { kind: 'number', part: numberStartOf(character) } };
  }
  return literal === undefined ? brokenAt(syntax) : { ...syntax, token: { kind: 'literal', rest: literal } };
}

function valueStarted(syntax: Syntax, character: string): Syntax {
  if (character === '{' || character === '[') {
    return opened(syntax, character === '{' ? 'object' : 'array');
  }
  return scalarStarted(syntax, character);
}

function keyStarted(syntax: Syntax, character: string): Syntax {
  return character === '"'
    ? { ...syntax, token: { kind: 'string', key: true, escaped: false, hexLeft: 0 } }
    : brokenAt(syntax);
}

function separated(syntax: Syntax, character: string): Syntax {
  if (character === ',') {
    return { ...syntax, expected: syntax.stack?.top === 'object' ? 'key' : 'value' };
  }
  if (character === '}' || character === ']') {
    return closed(syntax, character === '}' ? 'object' : 'array');
  }
  return brokenAt(syntax);
}

function markedOut(syntax: Syntax, character: string): Syntax {
  return character === ':' && syntax.expected === 'colon' ? { ...syntax, expected: 'value' } : brokenAt(syntax);
}

const structural: Readonly<Record<Expected, (syntax: Syntax, character: string) => Syntax>> = {
  value: valueStarted,
  value_or_close: (syntax, character) =>
    character === ']' ? closed(syntax, 'array') : valueStarted(syntax, character),
  key_or_close: (syntax, character) => (character === '}' ? closed(syntax, 'object') : keyStarted(syntax, character)),
  key: keyStarted,
  colon: markedOut,
  comma_or_close: separated,
  end: markedOut,
};

function stringEnded(syntax: Syntax, token: StringToken): Syntax {
  return token.key ? { ...syntax, token: undefined, expected: 'colon' } : afterValue(syntax);
}

function escapeRead(syntax: Syntax, token: StringToken, character: string): Syntax {
  const hexLeft = character === 'u' ? 4 : 0;
  return character === 'u' || simpleEscapes.has(character)
    ? { ...syntax, token: { ...token, escaped: false, hexLeft } }
    : brokenAt(syntax);
}

function stringRead(syntax: Syntax, token: StringToken, character: string): Syntax {
  if (token.hexLeft > 0) {
    return hexDigit.test(character) ? { ...syntax, token: { ...token, hexLeft: token.hexLeft - 1 } } : brokenAt(syntax);
  }
  if (token.escaped) {
    return escapeRead(syntax, token, character);
  }
  if (character === '\\') {
    return { ...syntax, token: { ...token, escaped: true } };
  }
  if (character === '"') {
    return stringEnded(syntax, token);
  }
  return Number(character.codePointAt(0)) <= lastControl ? brokenAt(syntax) : syntax;
}

function fractionOrExponent(character: string): NumberPart | 'end' | 'broken' {
  if (character === '.') {
    return 'dot';
  }
  if (exponentMarks.has(character)) {
    return 'e';
  }
  return isDigit(character) ? 'broken' : 'end';
}

const numberSteps: Readonly<Record<NumberPart, (character: string) => NumberPart | 'end' | 'broken'>> = {
  minus: (character) => {
    if (character === '0') {
      return 'zero';
    }
    return isDigit(character) ? 'int' : 'broken';
  },
  zero: (character) => fractionOrExponent(character),
  int: (character) => (isDigit(character) ? 'int' : fractionOrExponent(character)),
  dot: (character) => (isDigit(character) ? 'fraction' : 'broken'),
  fraction: (character) => {
    if (isDigit(character)) {
      return 'fraction';
    }
    return exponentMarks.has(character) ? 'e' : 'end';
  },
  e: (character) => {
    if (character === '+' || character === '-') {
      return 'exponent_sign';
    }
    return isDigit(character) ? 'exponent' : 'broken';
  },
  exponent_sign: (character) => (isDigit(character) ? 'exponent' : 'broken'),
  exponent: (character) => (isDigit(character) ? 'exponent' : 'end'),
};

function numberRead(syntax: Syntax, token: NumberToken, character: string): Syntax {
  const next = numberSteps[token.part](character);
  if (next === 'end') {
    return takenCharacter(afterValue(syntax), character);
  }
  if (next === 'broken') {
    return brokenAt(syntax);
  }
  return next === token.part ? syntax : { ...syntax, token: { kind: 'number', part: next } };
}

function literalRead(syntax: Syntax, token: LiteralToken, character: string): Syntax {
  if (!token.rest.startsWith(character)) {
    return brokenAt(syntax);
  }
  const rest = token.rest.slice(1);
  return rest === '' ? afterValue(syntax) : { ...syntax, token: { kind: 'literal', rest } };
}

function takenCharacter(syntax: Syntax, character: string): Syntax {
  const { token } = syntax;
  if (token?.kind === 'string') {
    return stringRead(syntax, token, character);
  }
  if (token?.kind === 'number') {
    return numberRead(syntax, token, character);
  }
  if (token?.kind === 'literal') {
    return literalRead(syntax, token, character);
  }
  return whiteSpace.has(character) ? syntax : structural[syntax.expected](syntax, character);
}

function endedWell(syntax: Syntax): boolean {
  const { token } = syntax;
  const settled = token?.kind === 'number' && numberEnds.has(token.part) ? afterValue(syntax) : syntax;
  return !settled.broken && settled.token === undefined && settled.expected === 'end';
}

function foundIn(syntax: Syntax): JsonFound {
  if (syntax.tooDeep) {
    return 'too_deep';
  }
  return endedWell(syntax) ? 'one_value' : 'not_one_value';
}

function takenText(syntax: Syntax, text: string): Syntax {
  let taken = syntax;
  for (const character of text) {
    if (taken.broken) {
      return taken;
    }
    taken = takenCharacter(taken, character);
  }
  return taken;
}

export function jsonSyntaxCheck(mostDepth: number): JsonSyntaxCheck {
  let syntax: Syntax = {
    expected: 'value',
    token: undefined,
    stack: undefined,
    mostDepth,
    broken: false,
    tooDeep: false,
  };
  return {
    take: (text) => {
      syntax = takenText(syntax, text);
    },
    ended: () => foundIn(syntax),
  };
}
