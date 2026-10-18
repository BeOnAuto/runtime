export function charactersIn(text: string): number {
  return Array.from(text).length;
}

export function firstCharacters(text: string, count: number): string {
  let taken = 0;
  let end = 0;
  for (const character of text) {
    if (taken === count) {
      return text.slice(0, end);
    }
    taken += 1;
    end += character.length;
  }
  return text;
}
