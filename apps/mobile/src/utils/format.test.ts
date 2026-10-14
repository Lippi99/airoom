import { formatDimensions, formatPrice } from './format';

describe('formatDimensions', () => {
  it('converts meters to rounded centimeters in W × D × H order', () => {
    expect(formatDimensions({ width: 2.1, depth: 0.924, height: 0.82 })).toBe('210 × 92 × 82 cm');
  });
});

describe('formatPrice', () => {
  it('formats a currency amount in the device locale', () => {
    // Grouping separator depends on locale: "1,899", "1.899", "1 899".
    expect(formatPrice(1899, 'USD')).toMatch(/1[.,\s  ]?899/);
  });

  it('falls back for an invalid currency code', () => {
    expect(formatPrice(10, 'NOPE')).toBe('10.00 NOPE');
  });
});
