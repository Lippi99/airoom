import { randomUUID } from 'node:crypto';
import type { SaveSceneRequest, SceneDto, SceneItemDto } from '@airoom/shared';
import type { Scene, SceneItem } from '../domain/entities';
import type { ProductRepository, SceneRepository } from '../domain/repositories';

export interface SceneServiceDeps {
  now?: () => Date;
  newId?: () => string;
}

/** Result of a create/update: the saved scene, or the product ids that are not in the catalog. */
export type SaveSceneResult = { scene: SceneDto } | { unknownProductIds: string[] };

export class SceneService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly scenes: SceneRepository,
    private readonly products: ProductRepository,
    deps: SceneServiceDeps = {},
  ) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? randomUUID;
  }

  /** All scenes, most recently updated first. */
  async list(): Promise<SceneDto[]> {
    return (await this.scenes.findAll()).map(toDto);
  }

  async getById(id: string): Promise<SceneDto | null> {
    const scene = await this.scenes.findById(id);
    return scene ? toDto(scene) : null;
  }

  async create(request: SaveSceneRequest): Promise<SaveSceneResult> {
    const unknownProductIds = await this.findUnknownProducts(request);
    if (unknownProductIds.length > 0) return { unknownProductIds };
    const now = this.now();
    const scene: Scene = {
      id: this.newId(),
      name: request.name.trim(),
      items: request.items.map(toEntityItem),
      createdAt: now,
      updatedAt: now,
    };
    await this.scenes.save(scene);
    return { scene: toDto(scene) };
  }

  /** Replaces the name and items (anchors included); null when the scene does not exist. */
  async update(id: string, request: SaveSceneRequest): Promise<SaveSceneResult | null> {
    const existing = await this.scenes.findById(id);
    if (!existing) return null;
    const unknownProductIds = await this.findUnknownProducts(request);
    if (unknownProductIds.length > 0) return { unknownProductIds };
    const scene: Scene = { ...existing, name: request.name.trim(), items: request.items.map(toEntityItem), updatedAt: this.now() };
    await this.scenes.save(scene);
    return { scene: toDto(scene) };
  }

  /** Returns false when the scene does not exist. */
  delete(id: string): Promise<boolean> {
    return this.scenes.delete(id);
  }

  /** Ids that are missing from the catalog or inactive (a scene can only hold buyable products). */
  private async findUnknownProducts(request: SaveSceneRequest): Promise<string[]> {
    const ids = [...new Set(request.items.map((i) => i.productId))];
    const found = await Promise.all(ids.map((id) => this.products.findById(id)));
    return ids.filter((_, i) => !found[i]?.active);
  }
}

function toEntityItem(item: SceneItemDto): SceneItem {
  return {
    productId: item.productId,
    pose: { ...item.pose },
    ...(item.anchor
      ? { anchor: { cloudAnchorId: item.anchor.cloudAnchorId, expiresAt: new Date(item.anchor.expiresAt) } }
      : {}),
  };
}

function toDtoItem(item: SceneItem): SceneItemDto {
  return {
    productId: item.productId,
    pose: { ...item.pose },
    ...(item.anchor
      ? { anchor: { cloudAnchorId: item.anchor.cloudAnchorId, expiresAt: item.anchor.expiresAt.toISOString() } }
      : {}),
  };
}

function toDto(scene: Scene): SceneDto {
  return {
    id: scene.id,
    name: scene.name,
    items: scene.items.map(toDtoItem),
    createdAt: scene.createdAt.toISOString(),
    updatedAt: scene.updatedAt.toISOString(),
  };
}
