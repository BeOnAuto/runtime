import { paragraph, type Paragraph, type Phrases } from '../overview/overview.ts';

type Filling = 'run' | 'build';

export function templateLead(lead: string, filledBy: Filling): Paragraph {
  return paragraph(`${lead}, with the values of each ${filledBy} in place of the names in bold:`);
}

export function quoteLead(filledBy: Filling, ...lead: Phrases): Paragraph {
  return paragraph(...lead, `, with the ${filledBy}'s values in place of the words in brackets:`);
}

export function inBrackets(meaning: string): string {
  return `\\[${meaning}\\]`;
}
