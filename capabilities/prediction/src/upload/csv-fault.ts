export class CsvFault extends Error {
  readonly line: number;

  constructor(line: number, detail: string) {
    super(detail);
    this.line = line;
  }
}
