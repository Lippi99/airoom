import type { ProductDto } from '@airoom/shared';
import { sofaDto } from '../test/fixtures';
import { formatPrice } from './format';
import { buildShoppingList, formatTotals } from './shoppingList';

const chairDto: ProductDto = { ...sofaDto, id: 'prod-chair', name: 'Chair', price: 19.99 };
const lampDto: ProductDto = { ...sofaDto, id: 'prod-lamp', name: 'Lamp', price: 300, currency: 'EUR' };
const catalog = new Map([sofaDto, chairDto, lampDto].map((p) => [p.id, p]));

describe('buildShoppingList', () => {
  it('puts copies of a product on one line, in the order first placed', () => {
    const list = buildShoppingList([chairDto.id, sofaDto.id, chairDto.id], catalog);
    expect(list.lines).toEqual([
      { product: chairDto, quantity: 2 },
      { product: sofaDto, quantity: 1 },
    ]);
    expect(list.itemCount).toBe(3);
  });

  it('sums prices times quantities, rounded to cents', () => {
    const list = buildShoppingList([chairDto.id, chairDto.id, chairDto.id, sofaDto.id], catalog);
    expect(list.totals).toEqual([{ currency: 'USD', amount: 1958.97 }]);
  });

  it('keeps one total per currency', () => {
    const list = buildShoppingList([sofaDto.id, lampDto.id], catalog);
    expect(list.totals).toEqual([
      { currency: 'USD', amount: 1899 },
      { currency: 'EUR', amount: 300 },
    ]);
  });

  it('leaves out and counts items no longer in the catalog', () => {
    const list = buildShoppingList([sofaDto.id, 'prod-gone', 'prod-gone'], catalog);
    expect(list.lines).toEqual([{ product: sofaDto, quantity: 1 }]);
    expect(list.itemCount).toBe(1);
    expect(list.missing).toBe(2);
  });

  it('is empty for an empty scene', () => {
    expect(buildShoppingList([], catalog)).toEqual({ lines: [], totals: [], itemCount: 0, missing: 0 });
  });
});

describe('formatTotals', () => {
  it('joins the totals of several currencies', () => {
    expect(
      formatTotals([
        { currency: 'USD', amount: 1200 },
        { currency: 'EUR', amount: 300 },
      ]),
    ).toBe(`${formatPrice(1200, 'USD')} + ${formatPrice(300, 'EUR')}`);
  });

  it('is empty without totals', () => {
    expect(formatTotals([])).toBe('');
  });
});
