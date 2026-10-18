import { paragraph, type Paragraph } from '../overview/overview.ts';

type Filling = 'run' | 'build';

export function templateLead(lead: string, filledBy: Filling): Paragraph {
  return paragraph(`${lead}, with the values of each ${filledBy} in place of the names in bold:`);
}
