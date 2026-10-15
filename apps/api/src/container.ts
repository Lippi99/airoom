import { InMemoryCategoryRepository } from './repositories/in-memory/in-memory-category-repository';
import { InMemoryClickEventRepository } from './repositories/in-memory/in-memory-click-event-repository';
import { InMemoryProductRepository } from './repositories/in-memory/in-memory-product-repository';
import { InMemoryRetailerRepository } from './repositories/in-memory/in-memory-retailer-repository';
import { InMemorySceneRepository } from './repositories/in-memory/in-memory-scene-repository';
import { loadSeed } from './repositories/in-memory/seed';
import { CategoryService } from './services/category-service';
import { ClickService } from './services/click-service';
import type { Logger } from './services/logger';
import { ProductDtoMapper } from './services/product-dto-mapper';
import { ProductService } from './services/product-service';
import { SceneService } from './services/scene-service';

export interface Container {
  categoryService: CategoryService;
  productService: ProductService;
  clickService: ClickService;
  sceneService: SceneService;
}

/**
 * The only place that instantiates concrete repositories.
 * Swapping storage (e.g. a database) means changing only this function.
 */
export function createContainer({ logger }: { logger: Logger }): Container {
  const seed = loadSeed();
  const categories = new InMemoryCategoryRepository(seed.categories);
  const retailers = new InMemoryRetailerRepository(seed.retailers);
  const products = new InMemoryProductRepository(seed.products);
  const clicks = new InMemoryClickEventRepository();
  const scenes = new InMemorySceneRepository();

  const mapper = new ProductDtoMapper(categories, retailers);

  return {
    categoryService: new CategoryService(categories),
    productService: new ProductService(products, categories, mapper),
    clickService: new ClickService(products, clicks, logger),
    sceneService: new SceneService(scenes, products),
  };
}
