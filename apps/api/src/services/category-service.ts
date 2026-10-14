import type { CategoryDto } from '@airoom/shared';
import type { CategoryRepository } from '../domain/repositories';
import { toCategoryDto } from './product-dto-mapper';

export class CategoryService {
  constructor(private readonly categories: CategoryRepository) {}

  async list(): Promise<CategoryDto[]> {
    return (await this.categories.findAll()).map(toCategoryDto);
  }
}
