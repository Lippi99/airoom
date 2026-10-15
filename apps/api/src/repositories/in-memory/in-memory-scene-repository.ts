import type { Scene } from '../../domain/entities';
import type { SceneRepository } from '../../domain/repositories';

/** Scenes kept in memory: they are lost when the API restarts (no database yet). */
export class InMemorySceneRepository implements SceneRepository {
  private readonly scenes = new Map<string, Scene>();

  async findAll(): Promise<Scene[]> {
    return [...this.scenes.values()]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((s) => structuredClone(s));
  }

  async findById(id: string): Promise<Scene | null> {
    const scene = this.scenes.get(id);
    return scene ? structuredClone(scene) : null;
  }

  async save(scene: Scene): Promise<void> {
    this.scenes.set(scene.id, structuredClone(scene));
  }

  async delete(id: string): Promise<boolean> {
    return this.scenes.delete(id);
  }
}
