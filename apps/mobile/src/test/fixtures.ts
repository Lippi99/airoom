import type { ProductDto } from '@airoom/shared';

export const sofaDto: ProductDto = {
  id: 'prod-sofa-oslo',
  name: 'Oslo 3-Seater Sofa',
  description: 'Linen sofa',
  category: { id: 'cat-sofa', slug: 'sofa', name: 'Sofas' },
  retailer: { id: 'ret-north', name: 'Northwood Home' },
  price: 1899,
  currency: 'USD',
  dimensions: { width: 2.1, depth: 0.92, height: 0.82 },
  thumbnailUrl: 'https://img.example.com/sofa.png',
  model: {
    glbUrl: 'https://cdn.example.com/sofa.glb',
    usdzUrl: 'https://cdn.example.com/sofa.usdz',
    sizeBytes: 4_200_000,
  },
};
