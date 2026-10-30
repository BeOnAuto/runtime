import { outputText } from './output-text.ts';

const defaultClipLength = 400;

const ellipsis = '…';

const decimalNumber = /^-?\d+(?:\.\d+)?$/u;

const whitespace = /\s+/u;

const wholeDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const dollarsAndCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function amountOf(value: unknown): number {
  const amount = typeof value === 'string' && decimalNumber.test(value.trim()) ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new TypeError('money takes a number, or text that is a decimal number');
  }
  return amount;
}

function money(value: unknown): string {
  const amount = amountOf(value);
  return Number.isInteger(amount) ? wholeDollars.format(amount) : dollarsAndCents.format(amount);
}

export function clip(value: unknown, length: unknown = defaultClipLength): string {
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError('clip takes a length in characters, a whole number of 0 or more');
  }
  const text = outputText(value);
  if (text.length <= length) {
    return text;
  }
  const characters = Array.from(text);
  return characters.length <= length ? text : `${characters.slice(0, length).join('')}${ellipsis}`;
}

function words(value: unknown): number {
  return outputText(value)
    .split(whitespace)
    .filter((word) => word !== '').length;
}

export const addedFilters = { money, clip, words };
