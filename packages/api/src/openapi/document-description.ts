import { guideToolName } from '../guides/guide-tool.ts';
import { whatThisServerIsFor } from '../mcp/instructions.ts';

export const documentDescription = [
  ...whatThisServerIsFor,
  `Before writing a definition, read its format with ${guideToolName}, which also holds what these words mean and the recipes for common tasks.`,
  'Every operation answers a problem document when it does not succeed, and says in its description what it does, when to use it and which operation to use instead.',
].join(' ');
