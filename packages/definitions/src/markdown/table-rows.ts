const blankLine = /^[ \t]*$/u;

const outerBlanks = /^[ \t]+|[ \t]+$/gu;

const delimiterCell = /^:?-+:?$/u;

const outerPipes = /^\||\|$/gu;

function isDelimiterRow(line: string | undefined): boolean {
  const cells = line?.replaceAll(outerBlanks, '').replaceAll(outerPipes, '').split('|') ?? [];
  return line?.includes('|') === true && cells.every((cell) => delimiterCell.test(cell.replaceAll(outerBlanks, '')));
}

export function tableLinesOf(lines: readonly string[]): readonly boolean[] {
  let within = false;
  return lines.map((line, index) => {
    within = within ? !blankLine.test(line) : line.includes('|') && isDelimiterRow(lines.at(index + 1));
    return within;
  });
}
