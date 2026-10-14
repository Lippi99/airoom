import type { Retailer } from '../../domain/entities';
import type { RetailerRepository } from '../../domain/repositories';

export class InMemoryRetailerRepository implements RetailerRepository {
  private readonly retailers: Retailer[];

  constructor(seed: readonly Retailer[]) {
    this.retailers = seed.map((r) => ({ ...r }));
  }

  async findById(id: string): Promise<Retailer | null> {
    const retailer = this.retailers.find((r) => r.id === id);
    return retailer ? { ...retailer } : null;
  }
}
