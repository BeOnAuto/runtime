export const searchBounds = {
  termWords: 8,
  termCharacters: 64,
  termsCharacters: 1024,
  found: 100,
  summaryCharacters: 300,
} as const;

const spaces = /\s+/u;

const caseChange = /(?<lower>[\p{Ll}\p{N}])(?<upper>\p{Lu})/gu;

const notInAWord = /[^\p{L}\p{N}]+/u;

function nonEmpty(word: string): boolean {
  return word !== '';
}

function wordsWritten(terms: string): readonly string[] {
  return terms.split(spaces).filter((word) => nonEmpty(word));
}

export function termsWithinTheirBound(terms: string): true | string {
  const words = wordsWritten(terms);
  if (words.length === 0 || words.length > searchBounds.termWords) {
    return `Expected 1 to ${searchBounds.termWords} words, separated by spaces`;
  }
  return words.every((word) => word.length <= searchBounds.termCharacters)
    ? true
    : `Expected words of at most ${searchBounds.termCharacters} characters each`;
}

export function wordsIn(text: string): readonly string[] {
  return text
    .replaceAll(caseChange, '$<lower> $<upper>')
    .split(notInAWord)
    .filter((word) => nonEmpty(word))
    .map((word) => word.toLowerCase());
}

export function termWordsOf(terms: string): readonly string[] {
  return [...new Set(wordsIn(terms))];
}
