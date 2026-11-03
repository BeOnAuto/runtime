import { parse } from 'yaml';

import type { Capability } from '../../capability/capability.ts';
import { echo } from './echo.ts';

const endOfTheFrontMatter = '\n---\n';

function bodyAfterTheFrontMatter(source: string): string {
  return source.slice(source.lastIndexOf(endOfTheFrontMatter) + endOfTheFrontMatter.length);
}

function jsonOfTheYaml(source: string): string {
  const read: unknown = parse(source);
  return JSON.stringify(read);
}

export const echoingWorkflow: Capability = {
  ...echo,
  type: 'workflow',
  prepare: (source, stripped) => echo.prepare(jsonOfTheYaml(source), stripped),
};

export const echoingFunction: Capability = {
  ...echo,
  type: 'reasoning',
  prepare: (source, stripped) => echo.prepare(bodyAfterTheFrontMatter(source), stripped),
};
