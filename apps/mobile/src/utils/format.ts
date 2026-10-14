import type { Dimensions } from '@airoom/shared';

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Formats meters as "W × D × H cm", the way retailers list furniture sizes. */
export function formatDimensions({ width, depth, height }: Dimensions): string {
  const cm = (m: number) => Math.round(m * 100);
  return `${cm(width)} × ${cm(depth)} × ${cm(height)} cm`;
}
