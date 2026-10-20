import {
  columnsCompared,
  discordInvite,
  helpOfferedAt,
  LedgerOfAnotherVersion,
  remedyFor,
  whatHappened,
} from '../database/ledger-of-another-version.ts';
import { linkerFor, painterFor, type ColorDepth } from '../logging/terminal.ts';

const noticeWidth = 76;

function wrapped(text: string, indent: string): readonly string[] {
  const width = noticeWidth - indent.length;
  const lines: string[] = [];
  for (const word of text.split(' ')) {
    const last = lines.pop();
    if (last === undefined) {
      lines.push(word);
    } else if (last.length + 1 + word.length <= width) {
      lines.push(`${last} ${word}`);
    } else {
      lines.push(last, word);
    }
  }
  return lines.map((line) => `${indent}${line}`);
}

type Refusal = Pick<LedgerOfAnotherVersion, 'place' | 'holds' | 'table' | 'found' | 'kept'>;

function ledgerNotice(refusal: Refusal, depth: ColorDepth): string {
  const paint = painterFor(depth);
  const link = linkerFor(depth);
  const { says, command } = remedyFor(refusal.place);
  const shown = command === undefined ? [] : ['', `      ${paint('cyan', command)}`];
  return [
    `  ${paint('red', '✖')} ${paint('bold', 'Auto Runtime could not start')}`,
    '',
    ...wrapped(whatHappened(refusal), '  '),
    '',
    `  ${paint('bold', 'What you can do')}`,
    ...wrapped(says, '    '),
    ...shown,
    '',
    `  ${helpOfferedAt(paint('cyan', link(discordInvite, discordInvite)))}`,
    '',
    ...wrapped(columnsCompared(refusal), '  ').map((line) => paint('dim', line)),
  ].join('\n');
}

function refusalIn(failure: unknown): Refusal | undefined {
  if (failure instanceof LedgerOfAnotherVersion) {
    return failure;
  }
  return failure instanceof Error ? refusalIn(failure.cause) : undefined;
}

export function startupFailureNoticeIn(depth: ColorDepth): (failure: unknown) => string | undefined {
  return (failure) => {
    const refusal = refusalIn(failure);
    return refusal === undefined ? undefined : ledgerNotice(refusal, depth);
  };
}
