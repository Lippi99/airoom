import type { ProductDto } from '@airoom/shared';
import { formatPrice } from './format';

/** One product of a scene and how many copies of it are in the scene. */
export interface ShoppingLine {
  product: ProductDto;
  quantity: number;
}

export interface MoneyTotal {
  currency: string;
  amount: number;
}

export interface ShoppingList {
  /** One line per product, in the order each was first placed. */
  lines: ShoppingLine[];
  /** Sum per currency, in the order first seen (one entry when all prices share a currency). */
  totals: MoneyTotal[];
  /** Items whose product is in the catalog. */
  itemCount: number;
  /** Items whose product is no longer in the catalog (left out of lines and totals). */
  missing: number;
}

/** What buying a scene's items costs: copies of a product share a line, totals per currency. */
export function buildShoppingList(productIds: readonly string[], products: ReadonlyMap<string, ProductDto>): ShoppingList {
  const lines = new Map<string, ShoppingLine>();
  let missing = 0;
  for (const id of productIds) {
    const product = products.get(id);
    if (!product) {
      missing += 1;
      continue;
    }
    const line = lines.get(id);
    if (line) line.quantity += 1;
    else lines.set(id, { product, quantity: 1 });
  }
  const sums = new Map<string, number>();
  for (const { product, quantity } of lines.values()) {
    sums.set(product.currency, (sums.get(product.currency) ?? 0) + product.price * quantity);
  }
  return {
    lines: [...lines.values()],
    // Rounded to cents: summing decimal prices leaves float noise (19.99 × 3 = 59.970000000000006).
    totals: [...sums].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
    itemCount: productIds.length - missing,
    missing,
  };
}

/** "$2,147.00", or "$1,200.00 + €300.00" when the products are priced in several currencies. */
export function formatTotals(totals: readonly MoneyTotal[]): string {
  return totals.map((t) => formatPrice(t.amount, t.currency)).join(' + ');
}
