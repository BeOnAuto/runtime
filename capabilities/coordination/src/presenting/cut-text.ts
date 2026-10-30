const utf8 = new TextEncoder();

function encodedBytesOf(character: string): number {
  return utf8.encode(JSON.stringify(character)).byteLength - 2;
}

export function cutAtCodePoint(text: string, mostBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    bytes += encodedBytesOf(character);
    if (bytes > mostBytes) {
      return text.slice(0, end);
    }
    end += character.length;
  }
  return text;
}
