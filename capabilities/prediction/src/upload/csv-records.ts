import { CsvFault } from './csv-fault.ts';

export interface CsvRecord {
  readonly line: number;
  readonly fields: readonly string[];
}

type Place = 'field_start' | 'unquoted' | 'quoted' | 'quote_in_quoted' | 'carriage_return';

const quote = '"';

const quoteInside =
  'A quote stands inside a field that does not start with one; quote the whole field and double the quote';

const quoteGoesOn = 'A quoted field goes on after its closing quote; a field ends at its closing quote';

const loneCarriageReturn = 'A carriage return is not followed by a line feed; end each record with CRLF or LF';

export class CsvReader {
  #place: Place = 'field_start';
  #field = '';
  #fields: string[] = [];
  #line = 1;
  #recordLine = 1;
  #records: CsvRecord[] = [];

  read(text: string): readonly CsvRecord[] {
    for (const character of text) {
      this.#character(character);
    }
    return this.#taken();
  }

  end(): readonly CsvRecord[] {
    if (this.#place === 'quoted') {
      throw new CsvFault(this.#recordLine, 'A quoted field is never closed');
    }
    if (this.#place === 'carriage_return') {
      throw new CsvFault(this.#line, loneCarriageReturn);
    }
    if (this.#place !== 'field_start' || this.#fields.length > 0) {
      this.#recordEnded();
    }
    return this.#taken();
  }

  line(): number {
    return this.#line;
  }

  #character(character: string): void {
    switch (this.#place) {
      case 'quoted':
        this.#quoted(character);
        return;
      case 'quote_in_quoted':
        this.#afterQuote(character);
        return;
      case 'carriage_return':
        this.#afterCarriageReturn(character);
        return;
      case 'field_start':
      case 'unquoted':
        this.#outside(character);
    }
  }

  #outside(character: string): void {
    if (character === ',') {
      this.#separated();
    } else if (character === '\n') {
      this.#lineEnded();
    } else if (character === '\r') {
      this.#place = 'carriage_return';
    } else if (character === quote) {
      this.#quoteOpened();
    } else {
      this.#field += character;
      this.#place = 'unquoted';
    }
  }

  #quoteOpened(): void {
    if (this.#place === 'unquoted') {
      throw new CsvFault(this.#line, quoteInside);
    }
    this.#place = 'quoted';
  }

  #quoted(character: string): void {
    if (character === quote) {
      this.#place = 'quote_in_quoted';
      return;
    }
    this.#line += character === '\n' ? 1 : 0;
    this.#field += character;
  }

  #afterQuote(character: string): void {
    if (character === quote) {
      this.#field += quote;
      this.#place = 'quoted';
      return;
    }
    if (character !== ',' && character !== '\n' && character !== '\r') {
      throw new CsvFault(this.#line, quoteGoesOn);
    }
    this.#place = 'unquoted';
    this.#outside(character);
  }

  #afterCarriageReturn(character: string): void {
    if (character !== '\n') {
      throw new CsvFault(this.#line, loneCarriageReturn);
    }
    this.#lineEnded();
  }

  #separated(): void {
    this.#fields.push(this.#field);
    this.#field = '';
    this.#place = 'field_start';
  }

  #recordEnded(): void {
    this.#fields.push(this.#field);
    this.#records.push({ line: this.#recordLine, fields: this.#fields });
    this.#fields = [];
    this.#field = '';
  }

  #lineEnded(): void {
    this.#recordEnded();
    this.#line += 1;
    this.#recordLine = this.#line;
    this.#place = 'field_start';
  }

  #taken(): readonly CsvRecord[] {
    const read = this.#records;
    this.#records = [];
    return read;
  }
}
