import {
  columnsCompared,
  helpOfferedAt,
  ledgerOfAnotherVersionIn,
  type LedgerOfAnotherVersion,
} from '../database/ledger-of-another-version.ts';
import { colorDepthOf, linkerFor, painterFor, type ColorDepth, type ColorStream } from '../logging/terminal.ts';
import { discordInvite } from './local-banner.ts';

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

type Refusal = Pick<LedgerOfAnotherVersion, 'happened' | 'remedy' | 'table' | 'holds' | 'found' | 'kept'>;

function ledgerNotice(refusal: Refusal, depth: ColorDepth): string {
  const paint = painterFor(depth);
  const link = linkerFor(depth);
  const { says, command } = refusal.remedy;
  const shown = command === undefined ? [] : ['', `      ${paint('cyan', command)}`];
  return [
    `  ${paint('red', '✖')} ${paint('bold', 'Auto Runtime could not start')}`,
    '',
    ...wrapped(refusal.happened, '  '),
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

export function startupFailureNoticeFor(stderr: ColorStream): (failure: unknown) => string | undefined {
  const depth = colorDepthOf(stderr);
  return (failure) => {
    const refusal = ledgerOfAnotherVersionIn(failure);
    return refusal === undefined ? undefined : ledgerNotice(refusal, depth);
  };
}
