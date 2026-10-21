import { Buffer } from 'node:buffer';

import type { McpEndpoint } from '../mcp/instructions.ts';

export const mostInstructionCharacters = 2000;

export const mostDescriptionCharacters = 800;

const fewestDescriptionSentences = 3;

const mostDescriptionSentences = 8;

export const mostArgumentDescriptionCharacters = 300;

export const mostToolsOnAConnection = 32;

export const mostListingBytes: Readonly<Record<McpEndpoint, number>> = {
  'own org': 48_000,
  org: 13_100,
  playbook: 40_000,
};

export const mostGuideBytes = 65_536;

export const mostRecipeBytes = 4096;

export function mostGuidesBeyondTheRecipes(definitionTypes: number): number {
  return definitionTypes + 1;
}

export const mostRecipes = 4;

export function requireWithin(what: string, size: number, most: number, unit: string): void {
  if (size > most) {
    throw new Error(`${what}: ${size} ${unit}, more than the ${most} allowed`);
  }
}

function requireAtLeast(what: string, size: number, fewest: number, unit: string): void {
  if (size < fewest) {
    throw new Error(`${what}: ${size} ${unit}, fewer than the ${fewest} required`);
  }
}

function sentencesIn(text: string): number {
  return text.split(/(?<=[.!?])\s+(?=\S)/u).length;
}

export function requireSentencesWithin(what: string, text: string): void {
  const sentences = sentencesIn(text);
  requireAtLeast(what, sentences, fewestDescriptionSentences, 'sentences');
  requireWithin(what, sentences, mostDescriptionSentences, 'sentences');
}

export function requireTextWithin(what: string, text: string, most: number): void {
  requireWithin(what, text.length, most, 'characters');
}

export function requireBytesWithin(what: string, text: string, most: number): void {
  requireWithin(what, Buffer.byteLength(text, 'utf8'), most, 'bytes');
}
