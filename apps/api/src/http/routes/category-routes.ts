import type { FastifyInstance } from 'fastify';
import { ApiRoutes } from '@airoom/shared';
import type { CategoryService } from '../../services/category-service';

export function categoryRoutes(categoryService: CategoryService) {
  return async (app: FastifyInstance) => {
    app.get(ApiRoutes.categories, async () => categoryService.list());
  };
}
