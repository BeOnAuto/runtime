import { pointerOf, problem, type SettingProblem } from '@on.auto/config';

import { isToolName, toolNameShape } from '../names/tool-reference.ts';
import { toolServersSetting, type ServerEntryFields } from './server-entries.ts';

const everyTool = '*';

const leftOut = 'leave allowed out to allow every tool';

const everyToolWritten =
  'Every tool of the server is allowed when allowed is left out; name the tools to allow, or leave it out';

function namedProblem(written: readonly string[], tool: string, index: number): string | undefined {
  if (tool === everyTool) {
    return everyToolWritten;
  }
  if (!isToolName(tool)) {
    return `Expected ${toolNameShape}`;
  }
  return written.indexOf(tool) < index ? `${tool} is listed twice` : undefined;
}

export function toolListProblems(server: string, { allowed }: ServerEntryFields): readonly SettingProblem[] {
  if (allowed === undefined) {
    return [];
  }
  const place = (...path: readonly string[]) => pointerOf([server, 'allowed', ...path]);
  if (allowed.length === 0) {
    return [problem(toolServersSetting, place(), `Expected at least one tool; ${leftOut}`)];
  }
  return allowed.flatMap((tool, index) => {
    const detail = namedProblem(allowed, tool, index);
    return detail === undefined ? [] : [problem(toolServersSetting, place(String(index)), detail)];
  });
}
