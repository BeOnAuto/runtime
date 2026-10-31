import type { Issue } from './issue.ts';

export interface Choice {
  readonly value: string;
  readonly title: string;
  readonly issues: readonly Issue[];
}

export interface Options {
  readonly question: string;
  readonly choices: readonly Choice[];
}
