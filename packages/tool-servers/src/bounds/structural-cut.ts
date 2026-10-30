import { bytesOf, cutAtCodePoint } from './text-bytes.ts';

interface CutPlace {
  readonly index: number;
  readonly closers: string;
}

const separators = new Set([',', ':', ' ', '\t', '\n', '\r']);

const atomCharacter = /[-+.0-9A-Za-z]/u;

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function utf8BytesOf(codePoint: number): number {
  if (codePoint < 0x80) {
    return 1;
  }
  if (codePoint < 0x800) {
    return 2;
  }
  return codePoint < 0x1_00_00 ? 3 : 4;
}

class JsonCut {
  readonly #text: string;
  readonly #budget: number;
  #index = 0;
  #bytes = 0;
  #closers = '';
  #expectingKey = false;
  #best: CutPlace = { index: 0, closers: '' };

  constructor(text: string, budget: number) {
    this.#text = text;
    this.#budget = budget;
  }

  cut(): string {
    while (this.#index < this.#text.length && this.#bytes <= this.#budget) {
      this.#stepped();
    }
    return `${this.#text.slice(0, this.#best.index)}${this.#best.closers}`;
  }

  #advanced(units: number, bytes: number): void {
    this.#index += units;
    this.#bytes += bytes;
  }

  #noted(closers: string): void {
    if (this.#bytes + closers.length <= this.#budget) {
      this.#best = { index: this.#index, closers };
    }
  }

  #insideAnObject(): boolean {
    return this.#closers.startsWith('}');
  }

  #opened(closer: string): void {
    this.#closers = `${closer}${this.#closers}`;
    this.#expectingKey = closer === '}';
    this.#advanced(1, 1);
  }

  #closed(): void {
    this.#closers = this.#closers.slice(1);
    this.#advanced(1, 1);
    this.#noted(this.#closers);
  }

  #separated(separator: string): void {
    if (separator === ',') {
      this.#expectingKey = this.#insideAnObject();
    }
    if (separator === ':') {
      this.#expectingKey = false;
    }
    this.#advanced(1, 1);
  }

  #stringPartScanned(): void {
    if (this.#text[this.#index] === '\\') {
      const units = this.#text[this.#index + 1] === 'u' ? 6 : 2;
      this.#advanced(units, units);
      return;
    }
    const codePoint = Number(this.#text.codePointAt(this.#index));
    this.#advanced(codePoint > 0xff_ff ? 2 : 1, utf8BytesOf(codePoint));
  }

  #stringScanned(): void {
    const isValue = !(this.#insideAnObject() && this.#expectingKey);
    this.#advanced(1, 1);
    while (this.#text[this.#index] !== '"') {
      this.#stringPartScanned();
      if (this.#bytes > this.#budget) {
        return;
      }
      if (isValue) {
        this.#noted(`"${this.#closers}`);
      }
    }
    this.#advanced(1, 1);
    if (isValue) {
      this.#noted(this.#closers);
    }
  }

  #atomScanned(): void {
    const start = this.#index;
    while (atomCharacter.test(this.#text.charAt(this.#index))) {
      this.#index += 1;
    }
    this.#bytes += this.#index - start;
    this.#noted(this.#closers);
  }

  #stepped(): void {
    const character = this.#text.charAt(this.#index);
    if (character === '{' || character === '[') {
      this.#opened(character === '{' ? '}' : ']');
    } else if (character === '}' || character === ']') {
      this.#closed();
    } else if (character === '"') {
      this.#stringScanned();
    } else if (separators.has(character)) {
      this.#separated(character);
    } else {
      this.#atomScanned();
    }
  }
}

export function cutWhereValid(text: string, budget: number): string {
  if (bytesOf(text) <= budget) {
    return text;
  }
  return isJson(text) ? new JsonCut(text, budget).cut() : cutAtCodePoint(text, budget);
}
