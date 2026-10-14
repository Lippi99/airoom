import type { Category } from '../../domain/entities';
import type { CategoryRepository } from '../../domain/repositories';

export class InMemoryCategoryRepository implements CategoryRepository {
  private readonly categories: Category[];

  constructor(seed: readonly Category[]) {
    this.categories = seed.map((c) => ({ ...c }));
  }

  async findAll(): Promise<Category[]> {
    return this.categories.map((c) => ({ ...c }));
  }

  async findBySlug(slug: string): Promise<Category | null> {
    const category = this.categories.find((c) => c.slug === slug);
    return category ? { ...category } : null;
  }
}
