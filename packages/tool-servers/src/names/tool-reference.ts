export interface ToolReference {
  readonly server: string;
  readonly tool: string;
}

const everyTool = '*';

export const serverNamePattern = /^[a-z][a-z0-9-]{0,31}$/u;

export const toolNamePattern = /^[A-Za-z0-9_.-]{1,128}$/u;

export function isServerName(name: string): boolean {
  return serverNamePattern.test(name);
}

export function isToolName(name: string): boolean {
  return toolNamePattern.test(name);
}

export function namesEveryTool({ tool }: ToolReference): boolean {
  return tool === everyTool;
}

export function allowsTool(allowed: readonly string[] | null, tool: string): boolean {
  return allowed === null || allowed.includes(tool);
}

export function isAllowed(reference: ToolReference, allowed: readonly string[] | null): boolean {
  return namesEveryTool(reference) || allowsTool(allowed, reference.tool);
}

export function toolReferenceOf(written: string): ToolReference | undefined {
  const slash = written.indexOf('/');
  const server = written.slice(0, slash);
  const tool = written.slice(slash + 1);
  return slash > 0 && isServerName(server) && (tool === everyTool || isToolName(tool)) ? { server, tool } : undefined;
}

export function writtenOf({ server, tool }: ToolReference): string {
  return `${server}/${tool}`;
}

export const serverNameShape = 'a server name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter';

export const toolNameShape = 'a tool name of 1 to 128 letters, digits, underscores, hyphens and dots';

export const toolReferenceShape = `server/tool, or server/* for every tool of a server: ${serverNameShape}, and ${toolNameShape}`;
