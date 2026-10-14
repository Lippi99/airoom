import type { CategoryDto, ProductDto } from '@airoom/shared';
import type { Category, Product, Retailer } from '../domain/entities';
import type { CategoryRepository, RetailerRepository } from '../domain/repositories';

export function toCategoryDto(category: Category): CategoryDto {
  return { id: category.id, slug: category.slug, name: category.name };
}

/**
 * Turns `Product` entities into `ProductDto`s, embedding category and retailer summaries.
 * Entities keep referencing by id; only the DTO carries the related objects.
 */
export class ProductDtoMapper {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly retailers: RetailerRepository,
  ) {}

  async toDto(product: Product): Promise<ProductDto> {
    const [dto] = await this.toDtos([product]);
    // toDtos returns one DTO per input product.
    return dto!;
  }

  async toDtos(products: readonly Product[]): Promise<ProductDto[]> {
    if (products.length === 0) return [];

    const categoriesById = new Map((await this.categories.findAll()).map((c) => [c.id, c]));
    const retailerIds = [...new Set(products.map((p) => p.retailerId))];
    const retailersById = new Map<string, Retailer>();
    for (const retailer of await Promise.all(retailerIds.map((id) => this.retailers.findById(id)))) {
      if (retailer) retailersById.set(retailer.id, retailer);
    }

    return products.map((product) => {
      const category = categoriesById.get(product.categoryId);
      if (!category) {
        throw new Error(`Product "${product.id}" references unknown category "${product.categoryId}"`);
      }
      const retailer = retailersById.get(product.retailerId);
      if (!retailer) {
        throw new Error(`Product "${product.id}" references unknown retailer "${product.retailerId}"`);
      }
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        category: toCategoryDto(category),
        retailer: { id: retailer.id, name: retailer.name },
        price: product.price,
        currency: product.currency,
        dimensions: { ...product.dimensions },
        thumbnailUrl: product.thumbnailUrl,
        model: { ...product.model },
      };
    });
  }
}
