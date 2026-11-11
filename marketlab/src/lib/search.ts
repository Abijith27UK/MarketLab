import { DEMO_INSTRUMENTS, type DemoInstrument } from "./demoCatalogue";

/**
 * Pure helpers behind the global instrument search, kept separate from React so
 * the matching and keyboard behaviour can be tested directly.
 */

/** Case-insensitive prefix/substring match on symbol, then company name. */
export function filterDemoInstruments(query: string, limit = 8): DemoInstrument[] {
  const needle = query.trim().toUpperCase();
  if (!needle) return DEMO_INSTRUMENTS.slice(0, limit);
  const starts: DemoInstrument[] = [];
  const contains: DemoInstrument[] = [];
  for (const instrument of DEMO_INSTRUMENTS) {
    const symbol = instrument.symbol.toUpperCase();
    const name = instrument.name.toUpperCase();
    if (symbol.startsWith(needle)) starts.push(instrument);
    else if (symbol.includes(needle) || name.includes(needle)) contains.push(instrument);
  }
  return [...starts, ...contains].slice(0, limit);
}

/**
 * Moves the highlighted index by `delta`, wrapping at both ends so ArrowUp on
 * the first result lands on the last one.
 */
export function nextIndex(current: number, length: number, delta: 1 | -1): number {
  if (length <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}
