import type { FastifyInstance } from 'fastify';
import { ApiRoutes } from '@airoom/shared';
import type { ProductService } from '../../services/product-service';
import { requestOrigin, withAbsoluteAssetUrls, type AssetVersioner } from '../asset-urls';
import { sendNotFound, sendValidationError } from '../errors';
import { idParamsSchema, productListQuerySchema } from '../schemas';

export function productRoutes(productService: ProductService, assetVersioner?: AssetVersioner) {
  return async (app: FastifyInstance) => {
    app.get(ApiRoutes.products, async (request, reply) => {
      const query = productListQuerySchema.safeParse(request.query);
      if (!query.success) return sendValidationError(reply, query.error);
      const origin = requestOrigin(request);
      return (await productService.list(query.data)).map((p) => withAbsoluteAssetUrls(p, origin, assetVersioner));
    });

    app.get(`${ApiRoutes.products}/:id`, async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(reply, params.error);
      const product = await productService.getById(params.data.id);
      if (!product) return sendNotFound(reply, `Product "${params.data.id}" not found`);
      return withAbsoluteAssetUrls(product, requestOrigin(request), assetVersioner);
    });
  };
}
