import { sentencesIn } from '@on.auto/api';

type SentenceKind = 'heading' | 'words' | 'row' | 'example';

export interface Sentence {
  readonly kind: SentenceKind;
  readonly source: string;
  readonly heading: string;
}

interface Reading {
  readonly fence: string | undefined;
  readonly heading: string;
}

const openingFence = /^ {0,3}(`{3,}|~{3,})/u;

const closingFence = /^ {0,3}(`{3,}|~{3,})\s*$/u;

const headingLine = /^ {0,3}#{1,6}(?:\s|$)/u;

const headingMarks = /^ {0,3}#{1,6}\s*|\s+#+\s*$/gu;

const delimiterRow = /^\s*\|[\s|:-]*-[\s|:-]*$/u;

const itemMarker = /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s?)/u;

const cellBorder = /(?<!\\)\|/u;

export function cellsOf(row: string): readonly string[] {
  return row
    .trim()
    .replace(/^\|/u, '')
    .replace(/(?<!\\)\|$/u, '')
    .split(cellBorder)
    .map((cell) => cell.trim().replaceAll(String.raw`\|`, '|'));
}

function closes(fence: string, line: string): boolean {
  const marker = closingFence.exec(line)?.[1] ?? '';
  return marker.startsWith(fence.charAt(0)) && marker.length >= fence.length;
}

function exampleLine(reading: Reading, fence: string, line: string): readonly [Reading, readonly Sentence[]] {
  if (closes(fence, line)) {
    return [{ ...reading, fence: undefined }, []];
  }
  return [reading, line.trim() === '' ? [] : [{ kind: 'example', source: line, heading: reading.heading }]];
}

function wordsOf(reading: Reading, line: string): readonly Sentence[] {
  if (line.trim() === '' || delimiterRow.test(line)) {
    return [];
  }
  if (line.trimStart().startsWith('|')) {
    return [{ kind: 'row', source: line.trim(), heading: reading.heading }];
  }
  return sentencesIn(line.replace(itemMarker, '').trim())
    .filter((source) => source !== '')
    .map((source) => ({ kind: 'words', source, heading: reading.heading }));
}

function lineRead(reading: Reading, line: string): readonly [Reading, readonly Sentence[]] {
  if (reading.fence !== undefined) {
    return exampleLine(reading, reading.fence, line);
  }
  const fence = openingFence.exec(line)?.[1];
  if (fence !== undefined) {
    return [{ ...reading, fence }, []];
  }
  if (headingLine.test(line)) {
    const heading = line.replaceAll(headingMarks, '');
    return [{ ...reading, heading }, [{ kind: 'heading', source: heading, heading }]];
  }
  return [reading, wordsOf(reading, line)];
}

export function sentencesOfText(text: string): readonly Sentence[] {
  const sentences: Sentence[] = [];
  let reading: Reading = { fence: undefined, heading: '' };
  for (const line of text.split('\n')) {
    const [next, read] = lineRead(reading, line);
    sentences.push(...read);
    reading = next;
  }
  return sentences;
}
