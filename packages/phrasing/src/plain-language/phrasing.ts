const conjunction = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const disjunction = new Intl.ListFormat('en', { style: 'long', type: 'disjunction' });

const plurals = new Intl.PluralRules('en');

const sentenceEnd = /[.!?…]["”’)]*$/u;

const numbersBelowTwenty = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];

const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const firstSpelledNumber = 100;

const lastSpelledNumber = 599;

export interface Noun {
  readonly one: string;
  readonly other: string;
}

export function quoted(text: string): string {
  return `“${text}”`;
}

export function listed(items: readonly string[]): string {
  return conjunction.format(items);
}

export function alternatives(items: readonly string[]): string {
  return disjunction.format(items);
}

function belowAHundred(number: number): string {
  if (number < numbersBelowTwenty.length) {
    return String(numbersBelowTwenty[number]);
  }
  const ones = number % 10;
  const tensWord = String(tens[Math.floor(number / 10)]);
  return ones === 0 ? tensWord : `${tensWord}-${String(numbersBelowTwenty[ones])}`;
}

export function plainNumber(number: number): string {
  if (!Number.isInteger(number) || number < firstSpelledNumber || number > lastSpelledNumber) {
    return String(number);
  }
  const hundreds = `${belowAHundred(Math.floor(number / 100))} hundred`;
  const rest = number % 100;
  return rest === 0 ? hundreds : `${hundreds} and ${belowAHundred(rest)}`;
}

export function counted(count: number, noun: Noun): string {
  return `${plainNumber(count)} ${plurals.select(count) === 'one' ? noun.one : noun.other}`;
}

export function articled(noun: string): string {
  return /^[aeiou]/u.test(noun) ? `an ${noun}` : `a ${noun}`;
}

export function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function asSentence(text: string): string {
  const trimmed = text.trim();
  return sentenceEnd.test(trimmed) ? trimmed : `${trimmed}.`;
}
