import { parseDuration } from './duration.ts';

Deno.test('parseDuration parses Go-style configuration durations', () => {
  equal(parseDuration('20s'), 20_000);
  equal(parseDuration('10m'), 600_000);
  equal(parseDuration('1h30m'), 5_400_000);
  equal(parseDuration('0'), 0);
  equal(parseDuration(250), 250);
});

Deno.test('parseDuration rejects invalid values', () => {
  for (const value of ['1', 'soon', '-1s', '1x']) {
    try {
      parseDuration(value);
    } catch {
      continue;
    }
    throw new Error(`accepted invalid duration ${value}`);
  }
});

function equal(actual: number, expected: number): void {
  if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`);
}
