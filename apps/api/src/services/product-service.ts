import type { ProductDto, ProductListQuery } from '@airoom/shared';
import type { CategoryRepository, ProductRepository } from '../domain/repositories';
import type { ProductDtoMapper } from './product-dto-mapper';

export class ProductService {
  constructor(
    private readonly products: ProductRepository,
    private readonly categories: CategoryRepository,
    private readonly mapper: ProductDtoMapper,
  ) {}

  /** Lists active products, optionally filtered by category slug and search text. */
  async list(query: ProductListQuery = {}): Promise<ProductDto[]> {
    let categoryId: string | undefined;
    if (query.category) {
      const category = await this.categories.findBySlug(query.category);
      if (!category) return [];
      categoryId = category.id;
    }
    const search = query.search?.trim() || undefined;
    const products = await this.products.findAll({ categoryId, search, active: true });
    return this.mapper.toDtos(products);
  }

  /** Returns the product, or null when it does not exist or is inactive. */
  async getById(id: string): Promise<ProductDto | null> {
    const product = await this.products.findById(id);
    if (!product || !product.active) return null;
    return this.mapper.toDto(product);
  }
}
