import { charactersIn, firstCharacters } from '../plain-language/characters.ts';

export const mostDiagramLabelCharacters = 60;

const ellipsis = '…';

export function diagramLabel(text: string): string {
  return charactersIn(text) <= mostDiagramLabelCharacters
    ? text
    : `${firstCharacters(text, mostDiagramLabelCharacters - ellipsis.length).trimEnd()}${ellipsis}`;
}
