function folded(text: string): string {
  return text.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC');
}

export function wordsIn(text: string): readonly string[] {
  return folded(text)
    .split(/\s+/u)
    .filter((word) => word !== '');
}

export function holdsEveryWord(text: string, words: readonly string[]): boolean {
  const held = folded(text);
  return words.every((word) => held.includes(word));
}
