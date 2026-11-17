import { resolve } from 'node:path';

import { settingNames } from '@on.auto/server/setting-names';

import { sentencesOfText } from './agent-text-sentences.ts';
import { agentTextsRecordIn, placesIn, type AgentTextsRecord } from './agent-texts-record.ts';

export const textsNotYetClean: readonly string[] = [
  'guide connect-a-service',
  'guide lookup-function',
  'guide prediction-function',
  'guide reasoning-function',
  'guide terminology',
  'prompt connect-a-service: message',
  'prompt keep: attached guide://lookup-function',
  'tool add_connection: argument credential.variable',
];

const checking = 'pnpm docs:setting-names:check';

interface Finding {
  readonly text: string;
  readonly name: string;
  readonly sentence: string;
}

interface Declared {
  readonly name: string;
  readonly standing: (text: string) => boolean;
}

const partOfAName = 'A-Za-z0-9_';

const anOrdinaryWord = /^[a-z]+$/u;

function literally(name: string): string {
  return name.replaceAll(/[$()*+.?[\\\]^{|}-]/gu, String.raw`\$&`);
}

function standsIn(name: string): (text: string) => boolean {
  const ending = `${literally(name)}(?![${partOfAName}-])`;
  const standing = `(?<![${partOfAName}./-])${literally(name)}`;
  const pattern = anOrdinaryWord.test(name)
    ? new RegExp(`(?<=\`)${ending}|${standing}(?=\\.[A-Za-z_])`, 'u')
    : new RegExp(`${standing}(?![${partOfAName}-])`, 'u');
  return (text) => pattern.test(text);
}

function textsIn(record: AgentTextsRecord): ReadonlyMap<string, readonly string[]> {
  const texts = new Map<string, readonly string[]>();
  for (const { as, text } of placesIn(record)) {
    texts.set(as, [...new Set([...(texts.get(as) ?? []), text])]);
  }
  return texts;
}

export function findingsIn(record: AgentTextsRecord, names: readonly string[]): readonly Finding[] {
  const declared: readonly Declared[] = names.map((name) => ({ name, standing: standsIn(name) }));
  const findings = new Map<string, Finding>();
  for (const [as, texts] of textsIn(record)) {
    for (const { source } of texts.flatMap((text) => sentencesOfText(text))) {
      for (const { name } of declared.filter(({ standing }) => standing(source))) {
        findings.set(`${as}\n${name}\n${source}`, { text: as, name, sentence: source });
      }
    }
  }
  return [...findings.values()];
}

export function problemsIn(findings: readonly Finding[], notYetClean: readonly string[]): readonly string[] {
  const named = findings
    .filter(({ text }) => !notYetClean.includes(text))
    .map(({ text, name, sentence }) => `${text} names the setting ${name} in: ${sentence}`);
  const clean = notYetClean
    .filter((text) => !findings.some((finding) => finding.text === text))
    .map((text) => `${text} names no setting now: take it off textsNotYetClean in scripts/docs-setting-names.ts`);
  return [...named, ...clean];
}

export function checkSettingNames(
  record: AgentTextsRecord,
  names: readonly string[],
  notYetClean: readonly string[],
): void {
  const problems = problemsIn(findingsIn(record, names), notYetClean);
  if (problems.length > 0) {
    throw new Error(
      [
        'A text an agent reads names a setting the server declares, or a text on the list of those not yet clean is clean:',
        ...problems.map((problem) => `- ${problem}`),
      ].join('\n'),
    );
  }
}

export function runSettingNames(commandArguments: readonly string[], path: string, names = settingNames): void {
  if (commandArguments.length > 0) {
    throw new Error(`Usage: ${checking}`);
  }
  checkSettingNames(agentTextsRecordIn(path), names, textsNotYetClean);
}

if (import.meta.main) {
  runSettingNames(process.argv.slice(2), resolve(import.meta.dirname, '../docs/assets/agent-texts.json'));
}
