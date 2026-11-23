import { Buffer } from 'node:buffer';

import type { McpEndpoint } from '../mcp/instructions.ts';

export const mostDescriptionCharacters = 800;

const fewestDescriptionSentences = 3;

const mostDescriptionSentences = 8;

export const mostArgumentDescriptionCharacters = 300;

export const mostToolsOnAConnection = 47;

export const mostListingBytes: Readonly<Record<McpEndpoint, number>> = {
  'own org': 77_500,
  directory: 75_000,
  org: 29_000,
  playbook: 51_600,
};

export const mostGuideBytes = 65_536;

export const mostRecipeBytes = 10_240;

export function mostRecipeBytesWhere(goals: boolean): number {
  return goals ? mostRecipeBytes + 1024 : mostRecipeBytes;
}

export function mostGuidesBeyondTheRecipes(definitionTypes: number, goals = false): number {
  return definitionTypes + (goals ? 9 : 8);
}

export const mostRecipes = 5;

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

export function sentencesIn(text: string): readonly string[] {
  return text.split(/(?<=[.!?])\s+(?=\S)/u);
}

export function requireSentencesWithin(what: string, text: string): void {
  const sentences = sentencesIn(text).length;
  requireAtLeast(what, sentences, fewestDescriptionSentences, 'sentences');
  requireWithin(what, sentences, mostDescriptionSentences, 'sentences');
}

export function requireTextWithin(what: string, text: string, most: number): void {
  requireWithin(what, text.length, most, 'characters');
}

export function requireBytesWithin(what: string, text: string, most: number): void {
  requireWithin(what, Buffer.byteLength(text, 'utf8'), most, 'bytes');
}
