import { describe, expect, it } from 'vitest';

import { mostShownFieldBytes, mostToolFieldBytes, shownData } from '../index.ts';

function textOfBytes(bytes: number): string {
  return 'a'.repeat(bytes - 2);
}

describe('the data of an event on a page', () => {
  it('shows a large field whole within 2 KiB, and as its size past it', () => {
    const data = { output: textOfBytes(mostShownFieldBytes), input: textOfBytes(mostShownFieldBytes + 1), number: 1 };

    expect(shownData(data, 'page')).toEqual({
      output: data.output,
      input_bytes: mostShownFieldBytes + 1,
      number: 1,
    });
  });

  it('leaves out a result, and the arguments past 2 KiB, whose sizes the fact already holds', () => {
    const data = {
      arguments_bytes: 5000,
      arguments: { query: textOfBytes(mostShownFieldBytes) },
      result_bytes: 40,
      result: { content: [] },
      answer: { rows: 2 },
    };

    expect(shownData(data, 'page')).toEqual({ arguments_bytes: 5000, result_bytes: 40, answer: { rows: 2 } });
  });

  it('replaces the largest field by its size first when the data would still pass 4 KiB', () => {
    const data = {
      input: textOfBytes(1500),
      output: textOfBytes(2000),
      record: textOfBytes(1800),
      answer: textOfBytes(1000),
    };

    expect(shownData(data, 'page')).toEqual({
      input: data.input,
      output_bytes: 2000,
      record_bytes: 1800,
      answer: data.answer,
    });
  });

  it('keeps data within 4 KiB as it is, and a published event shows its data or its size', () => {
    expect(shownData({ kind: 'cron' }, 'page')).toEqual({ kind: 'cron' });
    expect(shownData({ data: textOfBytes(3000) }, 'page')).toEqual({ data_bytes: 3000 });
  });
});

describe('the data of a model call on a page', () => {
  it('shows its messages, its response, the tool calls it asked for, its warnings and its issues by the same rule', () => {
    const data = {
      messages_bytes: 9000,
      messages: { said: textOfBytes(mostShownFieldBytes) },
      response_bytes: 20,
      response: [{ role: 'assistant' }],
      tool_calls: [{ call_id: textOfBytes(mostShownFieldBytes) }],
      warnings: [{ detail: textOfBytes(mostShownFieldBytes) }],
      issues: [],
    };

    expect(shownData(data, 'page')).toEqual({
      messages_bytes: 9000,
      response_bytes: 20,
      response: [{ role: 'assistant' }],
      tool_calls_bytes: mostShownFieldBytes + 14,
      warnings_bytes: mostShownFieldBytes + 13,
      issues: [],
    });
  });
});

describe('the data of an event read whole', () => {
  it('shows every field whole', () => {
    const data = { output: textOfBytes(10_000), result: { content: [] } };

    expect(shownData(data, 'whole')).toBe(data);
  });

  it('as a tool shows every field that may be large whole within 64 KiB and as its size past it', () => {
    const data = {
      input: { asked: 'x' },
      output: textOfBytes(mostToolFieldBytes + 1),
      record: textOfBytes(mostToolFieldBytes),
      arguments_bytes: 12,
      arguments: { query: 'x' },
      result_bytes: mostToolFieldBytes * 2,
      result: textOfBytes(mostToolFieldBytes + 1),
      answer: textOfBytes(mostToolFieldBytes + 1),
    };

    expect(shownData(data, 'tool')).toEqual({
      input: { asked: 'x' },
      output_bytes: mostToolFieldBytes + 1,
      record: data.record,
      arguments_bytes: 12,
      arguments: { query: 'x' },
      result_bytes: mostToolFieldBytes * 2,
      answer_bytes: mostToolFieldBytes + 1,
    });
  });
});
