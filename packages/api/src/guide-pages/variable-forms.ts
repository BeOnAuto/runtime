const spanOpening = /^<span data-variable="([^"]*)">$/u;

const exampleOpening = /^<div data-variable="([^"]*)">$/u;

const aName = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u;

const wordCharacter = /[\p{L}\p{N}_]/u;

const joiner = /[./-]/u;

export function variableOfASpan(tag: string): string | undefined {
  return spanOpening.exec(tag)?.[1];
}

export function variablesOfAnExample(tag: string): string | undefined {
  return exampleOpening.exec(tag)?.[1];
}

export function unknownNamesIn(value: string, many: boolean): string | undefined {
  const named = value.split(' ');
  const known = named.every((name) => aName.test(name)) && new Set(named).size === named.length;
  return known && (many || named.length === 1)
    ? undefined
    : `names no value a page may name in data-variable="${value}": name ${many ? 'one or more values' : 'one value'}, each a capability's name and the value's, such as generation.most_image, separated by one space.`;
}

function continuesAt(text: string, at: number, beyond: number): boolean {
  return (
    wordCharacter.test(text.charAt(at)) || (joiner.test(text.charAt(at)) && wordCharacter.test(text.charAt(beyond)))
  );
}

export function startsOfWholeValues(text: string, value: string): readonly number[] {
  const starts: number[] = [];
  for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + value.length)) {
    if (!continuesAt(text, at - 1, at - 2) && !continuesAt(text, at + value.length, at + value.length + 1)) {
      starts.push(at);
    }
  }
  return starts;
}

export function holdsTheWholeValue(text: string, value: string): boolean {
  return startsOfWholeValues(text, value).length > 0;
}
