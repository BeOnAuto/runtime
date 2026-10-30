import ts from 'typescript6';

const settingsAdvice = ' Do you need to ';

function withoutSettingsAdvice(detail: string): string {
  const advice = detail.indexOf(settingsAdvice);
  return advice === -1 ? detail : detail.slice(0, advice);
}

export interface Located {
  readonly line: number;
  readonly detail: string;
}

export function locatedIn(file: () => ts.SourceFile, found: () => readonly ts.Diagnostic[]): readonly Located[] {
  const located: Located[] = [];
  for (const { start = 0, messageText } of found()) {
    located.push({
      line: file().getLineAndCharacterOfPosition(start).line + 1,
      detail: withoutSettingsAdvice(ts.flattenDiagnosticMessageText(messageText, ' ').replaceAll(/\s+/gu, ' ')),
    });
  }
  return located;
}
