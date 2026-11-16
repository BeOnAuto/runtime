import { cellsOf, everyTokenOf, type Token } from './page-tokens.ts';

const onlyPunctuation = /^[\p{P}\p{S}\s]+$/u;

function headingsWithNothingUnder(tokens: readonly Token[]): readonly string[] {
  const blocks = tokens.filter(({ type }) => type !== 'space');
  return blocks
    .filter(
      ({ type, depth }, index) =>
        type === 'heading' &&
        blocks.slice(index + 1, index + 2).every((next) => next.type === 'heading' && next.depth <= depth),
    )
    .map(({ text }) => `The heading "${text}" has nothing under it.`);
}

function tablesWithoutRows(tokens: readonly Token[]): readonly string[] {
  return everyTokenOf(tokens)
    .filter(
      ({ type, rows }) => type === 'table' && rows.every((cells) => cells.every(({ text }) => text.trim() === '')),
    )
    .map(({ header }) => `The table headed "${header.map(({ text }) => text).join(' | ')}" has no rows.`);
}

function isBare(passage: Pick<Token, 'text' | 'tokens'>): boolean {
  return (
    passage.tokens.length > 0 &&
    passage.tokens.every(({ type }) => type === 'text' || type === 'escape') &&
    onlyPunctuation.test(passage.text)
  );
}

function barePassages(tokens: readonly Token[]): readonly string[] {
  const every = everyTokenOf(tokens);
  const passages = [
    ...every.filter(({ type }) => type === 'paragraph' || type === 'heading' || type === 'text'),
    ...every.flatMap((token) => cellsOf(token)),
  ];
  const emptyItems = every.filter(({ type, text }) => type === 'list_item' && text.trim() === '');
  return [
    ...passages.filter((passage) => isBare(passage)).map(({ text }) => `The passage "${text}" is only punctuation.`),
    ...emptyItems.map(() => 'A list item is empty.'),
  ];
}

export function faultsOfARendition(rendition: string, tokens: readonly Token[]): readonly string[] {
  return [
    ...(rendition.trim() === '' ? ['The guide is empty.'] : []),
    ...headingsWithNothingUnder(tokens),
    ...tablesWithoutRows(tokens),
    ...barePassages(tokens),
  ];
}
