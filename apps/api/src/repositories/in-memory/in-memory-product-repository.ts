import type { Product } from '../../domain/entities';
import type { ProductFilter, ProductRepository } from '../../domain/repositories';

export class InMemoryProductRepository implements ProductRepository {
  private readonly products: Product[];

  constructor(seed: readonly Product[]) {
    this.products = seed.map((p) => structuredClone(p));
  }

  async findAll(filter: ProductFilter = {}): Promise<Product[]> {
    const search = filter.search?.trim().toLowerCase();
    return this.products
      .filter((p) => filter.categoryId === undefined || p.categoryId === filter.categoryId)
      .filter((p) => filter.active === undefined || p.active === filter.active)
      .filter(
        (p) =>
          !search ||
          p.name.toLowerCase().includes(search) ||
          p.description.toLowerCase().includes(search),
      )
      .map((p) => structuredClone(p));
  }

  async findById(id: string): Promise<Product | null> {
    const product = this.products.find((p) => p.id === id);
    return product ? structuredClone(product) : null;
  }
}
