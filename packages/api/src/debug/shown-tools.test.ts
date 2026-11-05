import { describe, expect, it } from 'vitest';

import { toolGroupsOf, type ShownTool } from './shown-tools.ts';

function toolNamed(name: string): ShownTool {
  return { name, title: name, description: `Does ${name}.`, hints: [], arguments: [] };
}

function groupsOf(names: readonly string[]): readonly (readonly [string, readonly string[]])[] {
  return toolGroupsOf(names.map((name) => toolNamed(name))).map(({ name, tools }) => [
    name,
    tools.map((tool) => tool.name),
  ]);
}

describe('the groups of the tools of a connection', () => {
  it('holds each tool in its group, in the order of the group, and those of no group under Other', () => {
    expect(groupsOf(['get_guide', 'add_note', 'list_runs', 'get_run', 'run_definition', 'list_notes'])).toEqual([
      ['Runs', ['run_definition', 'get_run', 'list_runs']],
      ['Guides', ['get_guide']],
      ['Other', ['add_note', 'list_notes']],
    ]);
  });

  it('leaves out a group with no tool', () => {
    expect(groupsOf(['get_asset'])).toEqual([['Assets', ['get_asset']]]);
  });
});
