import type { ClickEvent } from '../../domain/entities';
import type { ClickEventRepository } from '../../domain/repositories';

export class InMemoryClickEventRepository implements ClickEventRepository {
  private readonly events: ClickEvent[] = [];

  async save(event: ClickEvent): Promise<void> {
    this.events.push({ ...event, timestamp: new Date(event.timestamp) });
  }

  async countByProduct(productId: string): Promise<number> {
    return this.events.filter((e) => e.productId === productId).length;
  }
}
