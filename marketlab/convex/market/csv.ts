/**
 * CSV OHLCV ingestion.
 *
 * Accepts a header (`timestamp,open,high,low,close,volume`) or headerless
 * positional rows. Every row is validated; malformed rows are reported back
 * instead of being silently dropped, and duplicate timestamps are collapsed.
 */

import type { Interval, NormalizedCandle } from "./types";
import { normalizeCandles, validateCandle } from "./normalize";
import { IST_OFFSET_MS } from "./time";

export interface CsvRejection {
  line: number;
  reason: string;
}

export interface CsvParseResult {
  candles: NormalizedCandle[];
  rejected: CsvRejection[];
  summary: {
    totalRows: number;
    acceptedRows: number;
    rejectedRows: number;
    duplicatesRemoved: number;
    firstTs: number | null;
    lastTs: number | null;
  };
}

export interface CsvParseOptions {
  instrumentId: string;
  interval: Interval;
  source?: NormalizedCandle["source"];
  mode?: NormalizedCandle["mode"];
  maxRows?: number;
}

const HEADER_ALIASES: Record<string, string> = {
  timestamp: "timestamp",
  time: "timestamp",
  datetime: "timestamp",
  date: "timestamp",
  ts: "timestamp",
  open: "open",
  o: "open",
  high: "high",
  h: "high",
  low: "low",
  l: "low",
  close: "close",
  c: "close",
  volume: "volume",
  vol: "volume",
  v: "volume",
};

/** Splits one CSV line, honouring double-quoted fields and escaped quotes. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Parses a timestamp cell into a true UTC epoch millisecond value.
 *
 * Accepted forms: epoch seconds, epoch milliseconds, ISO-8601 with an explicit
 * offset, or a "naive" Indian-market date/time which is interpreted as IST.
 * Returns an error string when the value cannot be interpreted unambiguously.
 */
export function parseTimestampCell(raw: string): { ts: number } | { error: string } {
  const value = raw.trim();
  if (!value) return { error: "empty timestamp" };

  if (/^\d{10}$/.test(value)) return { ts: Number(value) * 1000 };
  if (/^\d{13}$/.test(value)) return { ts: Number(value) };

  const isoWithOffset = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i;
  const match = isoWithOffset.exec(value);
  if (match) {
    const [, y, mo, d, hh, mm, ss, offset] = match;
    const base = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(hh),
      Number(mm),
      Number(ss ?? "0")
    );
    if (offset.toUpperCase() === "Z") return { ts: base };
    const sign = offset.startsWith("-") ? -1 : 1;
    const [oh, om] = offset.slice(1).replace(":", "").match(/\d{2}/g) ?? [];
    const offsetMs = sign * (Number(oh) * 60 + Number(om)) * 60_000;
    return { ts: base - offsetMs };
  }

  const naiveDateTime = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/i;
  const naive = naiveDateTime.exec(value);
  if (naive) {
    const [, y, mo, d, hh, mm, ss] = naive;
    const wall = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(hh ?? "0"),
      Number(mm ?? "0"),
      Number(ss ?? "0")
    );
    // Naive Indian-market timestamps are IST wall-clock values.
    return { ts: wall - IST_OFFSET_MS };
  }

  return { error: `unrecognised timestamp "${value}"` };
}

function detectHeader(fields: string[]): Record<string, number> | null {
  const map: Record<string, number> = {};
  fields.forEach((field, index) => {
    const key = HEADER_ALIASES[field.trim().toLowerCase()];
    if (key && map[key] === undefined) map[key] = index;
  });
  const required = ["timestamp", "open", "high", "low", "close"];
  return required.every((key) => map[key] !== undefined) ? map : null;
}

function toNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned.toLowerCase() === "null") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseOhlcvCsv(text: string, options: CsvParseOptions): CsvParseResult {
  const source = options.source ?? "sample";
  const mode = options.mode ?? "SAMPLE";
  const maxRows = options.maxRows ?? 200_000;

  const lines = text
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim().length > 0 && !line.trim().startsWith("#"));

  const rejected: CsvRejection[] = [];
  const parsed: NormalizedCandle[] = [];
  let headerMap: Record<string, number> = {
    timestamp: 0,
    open: 1,
    high: 2,
    low: 3,
    close: 4,
    volume: 5,
  };
  let dataLines = lines;

  if (lines.length > 0) {
    const firstFields = parseCsvLine(lines[0].line);
    const detected = detectHeader(firstFields);
    if (detected) {
      headerMap = detected;
      dataLines = lines.slice(1);
    }
  }

  if (dataLines.length > maxRows) {
    return {
      candles: [],
      rejected: [{ line: 0, reason: `file has ${dataLines.length} rows, limit is ${maxRows}` }],
      summary: {
        totalRows: dataLines.length,
        acceptedRows: 0,
        rejectedRows: dataLines.length,
        duplicatesRemoved: 0,
        firstTs: null,
        lastTs: null,
      },
    };
  }

  for (const { line, number } of dataLines) {
    const fields = parseCsvLine(line);
    if (fields.every((field) => field === "")) continue;

    const parsedTimestamp = parseTimestampCell(fields[headerMap.timestamp] ?? "");
    if ("error" in parsedTimestamp) {
      rejected.push({ line: number, reason: parsedTimestamp.error });
      continue;
    }

    const open = toNumber(fields[headerMap.open]);
    const high = toNumber(fields[headerMap.high]);
    const low = toNumber(fields[headerMap.low]);
    const close = toNumber(fields[headerMap.close]);
    const volume = headerMap.volume === undefined ? null : toNumber(fields[headerMap.volume]);

    if (open === null || high === null || low === null || close === null) {
      rejected.push({ line: number, reason: "missing or non-numeric OHLC value" });
      continue;
    }

    const candle: NormalizedCandle = {
      instrumentId: options.instrumentId,
      interval: options.interval,
      ts: parsedTimestamp.ts,
      open,
      high,
      low,
      close,
      volume: volume === null ? null : Math.round(volume),
      source,
      mode,
      adjusted: "unknown",
    };

    const problem = validateCandle(candle);
    if (problem) {
      rejected.push({ line: number, reason: problem });
      continue;
    }
    parsed.push(candle);
  }

  const normalized = normalizeCandles(parsed);
  const candles = normalized.candles;
  return {
    candles,
    rejected,
    summary: {
      totalRows: dataLines.length,
      acceptedRows: candles.length,
      rejectedRows: rejected.length,
      duplicatesRemoved: normalized.duplicatesRemoved,
      firstTs: candles.length > 0 ? candles[0].ts : null,
      lastTs: candles.length > 0 ? candles[candles.length - 1].ts : null,
    },
  };
}
