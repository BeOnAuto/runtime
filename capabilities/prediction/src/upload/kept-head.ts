import { CsvFault } from './csv-fault.ts';
import { CsvReader, type CsvRecord } from './csv-records.ts';

export interface KeptHead {
  readonly columns: readonly string[];
  readonly firstPeriod: string;
}

interface Reading {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly csv: CsvReader;
  readonly text: TextDecoder;
}

const recordsOfAHead = 2;

async function headRecords(reading: Reading, records: readonly CsvRecord[]): Promise<readonly CsvRecord[]> {
  if (records.length >= recordsOfAHead) {
    return records;
  }
  const { done, value } = await reading.reader.read();
  if (done) {
    return [...records, ...reading.csv.read(reading.text.decode()), ...reading.csv.end()];
  }
  return headRecords(reading, [...records, ...reading.csv.read(reading.text.decode(value, { stream: true }))]);
}

function headOf([header, first]: readonly CsvRecord[]): KeptHead | undefined {
  const [series, period, ...columns] = header?.fields ?? [];
  const firstPeriod = first?.fields[1];
  return series === 'series' && period === 'period' && firstPeriod !== undefined ? { columns, firstPeriod } : undefined;
}

export async function keptHeadOf(stream: ReadableStream<Uint8Array>): Promise<KeptHead | undefined> {
  const reader = stream.getReader();
  try {
    return headOf(await headRecords({ reader, csv: new CsvReader(), text: new TextDecoder() }, []));
  } catch (error) {
    if (error instanceof CsvFault) {
      return undefined;
    }
    throw error;
  } finally {
    await reader.cancel();
  }
}
