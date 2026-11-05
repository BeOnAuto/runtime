import { startGuideName } from '../guides/start-guide.ts';
import { whatThisServerIsFor } from '../mcp/instructions.ts';

export const documentDescription = [
  ...whatThisServerIsFor,
  `Before anything else, read the guide ${startGuideName}, at /guides/${startGuideName}: it says what a playbook is made of, what a workflow owns, what the agent does itself, and which guide each task needs; the other guides hold what these words mean, the format of each definition and the recipes for common tasks.`,
  'Every operation answers a problem document when it does not succeed, and says in its description what it does, when to use it and which operation to use instead.',
].join(' ');
