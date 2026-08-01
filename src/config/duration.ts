const DURATION_PART = /^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/u;
const UNIT_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  'µs': 1e-3,
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

/** Parse the Go-style duration values used by the configuration (for example 20s or 1h). */
export function parseDuration(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error('duration must be non-negative');
    return value;
  }

  const input = value.trim();
  if (input === '0') return 0;
  let remaining = input;
  let milliseconds = 0;
  while (remaining) {
    const match = DURATION_PART.exec(remaining);
    if (!match) throw new Error(`invalid duration: ${value}`);
    const amountText = match[1];
    const unitName = match[2];
    if (!amountText || !unitName) throw new Error(`invalid duration: ${value}`);
    const amount = Number(amountText);
    const unit = UNIT_MS[unitName];
    if (unit === undefined) throw new Error(`invalid duration: ${value}`);
    milliseconds += amount * unit;
    if (!Number.isFinite(milliseconds)) throw new Error(`duration is too large: ${value}`);
    remaining = remaining.slice(match[0].length);
  }
  return milliseconds;
}
