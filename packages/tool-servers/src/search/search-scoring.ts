import { Order } from 'effect';

import { searchBounds, termWordsOf, wordsIn } from './search-terms.ts';

export interface Searchable {
  readonly names: readonly string[];
  readonly argumentNames: readonly string[];
  readonly description: string;
}

interface Scored<A> {
  readonly candidate: A;
  readonly score: number;
}

const weights = { name: 3, argument: 2, description: 1 } as const;

const sentenceEnd = /(?<=[.!?])\s|\n/u;

function wordsOfEach(texts: readonly string[]): ReadonlySet<string> {
  return new Set(texts.flatMap((text) => wordsIn(text)));
}

function weightIn(words: ReadonlySet<string>, word: string, weight: number): number {
  return words.has(word) ? weight : 0;
}

function scoreOf({ names, argumentNames, description }: Searchable, words: readonly string[]): number {
  const name = wordsOfEach(names);
  const argumentWords = wordsOfEach(argumentNames);
  const described = new Set(wordsIn(description));
  return words.reduce(
    (score, word) =>
      score +
      weightIn(name, word, weights.name) +
      weightIn(argumentWords, word, weights.argument) +
      weightIn(described, word, weights.description),
    0,
  );
}

function bestFirstThen<A>(tied: Order.Order<A>): Order.Order<Scored<A>> {
  return Order.combine(
    Order.flip(Order.mapInput(Order.Number, ({ score }: Scored<A>) => score)),
    Order.mapInput(tied, ({ candidate }: Scored<A>) => candidate),
  );
}

function scoredOf<A>(
  candidates: readonly A[],
  terms: string,
  searchableOf: (candidate: A) => Searchable,
): readonly Scored<A>[] {
  const words = termWordsOf(terms);
  return candidates.map((candidate) => ({ candidate, score: scoreOf(searchableOf(candidate), words) }));
}

export function rankedOf<A>(
  candidates: readonly A[],
  terms: string,
  searchableOf: (candidate: A) => Searchable,
  tied: Order.Order<A>,
): readonly A[] {
  return scoredOf(candidates, terms, searchableOf)
    .toSorted(bestFirstThen(tied))
    .map(({ candidate }) => candidate);
}

export function bestOf<A>(
  candidates: readonly A[],
  terms: string,
  searchableOf: (candidate: A) => Searchable,
  tied: Order.Order<A>,
): readonly A[] {
  return scoredOf(candidates, terms, searchableOf)
    .filter(({ score }) => score > 0)
    .toSorted(bestFirstThen(tied))
    .slice(0, searchBounds.found)
    .map(({ candidate }) => candidate);
}

export function wholeWithinTheBound<A>(candidates: readonly A[]): readonly A[] {
  return candidates.length <= searchBounds.found ? candidates : [];
}

export function summaryOf(description: string): string {
  const end = description.search(sentenceEnd);
  const first = end === -1 ? description : description.slice(0, end);
  return Array.from(first.trim()).slice(0, searchBounds.summaryCharacters).join('');
}
