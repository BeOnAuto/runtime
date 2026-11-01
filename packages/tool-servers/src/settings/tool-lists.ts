import { pointerOf, problem, type SettingProblem } from '@on.auto/config';

import { toolMarks, type GivenMark } from '../bounds/tool-results.ts';
import { isToolName, toolNameShape } from '../names/tool-reference.ts';
import { toolServersSetting, type ServerEntryFields } from './server-entries.ts';

interface MarkIssue {
  readonly path: readonly PropertyKey[];
  readonly detail: string;
}

type WrittenMarks = NonNullable<ServerEntryFields['marks']>;

const everyTool = '*';

const leftOut = 'leave allowed out to allow every tool';

const everyToolWritten =
  'Every tool of the server is allowed when allowed is left out; name the tools to allow, or leave it out';

const givenMarks = toolMarks.filter((mark): mark is GivenMark => mark !== 'unmarked');

const noMarkWritten = 'Expected reads or acts, or both; leave marks out to mark no tool';

function namedProblem(written: readonly string[], tool: string, index: number): string | undefined {
  if (tool === everyTool) {
    return everyToolWritten;
  }
  if (!isToolName(tool)) {
    return `Expected ${toolNameShape}`;
  }
  return written.indexOf(tool) < index ? `${tool} is listed twice` : undefined;
}

function markedProblem(
  marks: WrittenMarks,
  mark: GivenMark,
  marked: readonly string[],
  [tool, index]: readonly [string, number],
): string | undefined {
  if (!isToolName(tool)) {
    return `Expected ${toolNameShape}`;
  }
  if (marked.indexOf(tool) < index) {
    return `${tool} is listed twice`;
  }
  return mark === 'acts' && (marks.reads ?? []).includes(tool)
    ? `${tool} is marked reads too, and a tool takes one mark`
    : undefined;
}

type WrittenMark = readonly [mark: GivenMark, tools: readonly string[]];

function issuesOfAMark(marks: WrittenMarks, [mark, tools]: WrittenMark): readonly MarkIssue[] {
  if (tools.length === 0) {
    return [{ path: [mark], detail: `Expected at least one tool; leave ${mark} out to mark no tool ${mark}` }];
  }
  return tools.flatMap((tool, index) => {
    const detail = markedProblem(marks, mark, tools, [tool, index]);
    return detail === undefined ? [] : [{ path: [mark, index], detail }];
  });
}

function issuesOfTheMarks(marks: WrittenMarks): readonly MarkIssue[] {
  const written = givenMarks.flatMap((mark): readonly WrittenMark[] => {
    const tools = marks[mark];
    return tools === undefined ? [] : [[mark, tools]];
  });
  return written.length === 0
    ? [{ path: [], detail: noMarkWritten }]
    : written.flatMap((each) => issuesOfAMark(marks, each));
}

export function markIssuesOf(marks: WrittenMarks | undefined): readonly MarkIssue[] {
  return marks === undefined ? [] : issuesOfTheMarks(marks);
}

export function marksOf(marks?: WrittenMarks): Pick<ServerEntryFields, 'marks'> {
  return marks === undefined ? {} : { marks };
}

function allowedProblems(server: string, allowed: readonly string[] | undefined): readonly SettingProblem[] {
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

export function toolListProblems(server: string, { allowed, marks }: ServerEntryFields): readonly SettingProblem[] {
  return [
    ...allowedProblems(server, allowed),
    ...markIssuesOf(marks).map(({ path, detail }) =>
      problem(toolServersSetting, pointerOf([server, 'marks', ...path]), detail),
    ),
  ];
}
