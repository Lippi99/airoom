import { initialSceneState, newInstanceId, sceneReducer, type SceneState } from './scene';

const sofa = { instanceId: 'sofa:1', productId: 'sofa' };

describe('sceneReducer', () => {
  it('tracks a placement from start to success', () => {
    let state = sceneReducer(initialSceneState, { type: 'placeStarted', instanceId: 'sofa:1' });
    expect(state.placingId).toBe('sofa:1');
    state = sceneReducer(state, { type: 'placeSucceeded', item: sofa });
    expect(state.items).toEqual([sofa]);
    expect(state.placingId).toBeNull();
  });

  it('does not duplicate an item placed twice', () => {
    const state = sceneReducer({ ...initialSceneState, items: [sofa] }, { type: 'placeSucceeded', item: sofa });
    expect(state.items).toHaveLength(1);
  });

  it('clears placing state and selection on failure', () => {
    const start: SceneState = { items: [], selectedId: 'sofa:1', placingId: 'sofa:1' };
    expect(sceneReducer(start, { type: 'placeFailed', instanceId: 'sofa:1' })).toEqual(initialSceneState);
  });

  it('removes an item and its selection', () => {
    const start: SceneState = { items: [sofa], selectedId: 'sofa:1', placingId: null };
    expect(sceneReducer(start, { type: 'removed', instanceId: 'sofa:1' })).toEqual(initialSceneState);
  });

  it('clears the scene', () => {
    const start: SceneState = { items: [sofa], selectedId: 'sofa:1', placingId: null };
    expect(sceneReducer(start, { type: 'cleared' })).toEqual(initialSceneState);
  });

  it('selects and deselects', () => {
    const selected = sceneReducer(initialSceneState, { type: 'selected', instanceId: 'sofa:1' });
    expect(selected.selectedId).toBe('sofa:1');
    expect(sceneReducer(selected, { type: 'selected', instanceId: null }).selectedId).toBeNull();
  });
});

describe('newInstanceId', () => {
  it('is unique per call and keeps the product id', () => {
    const a = newInstanceId('prod-1');
    const b = newInstanceId('prod-1');
    expect(a).not.toBe(b);
    expect(a.startsWith('prod-1:')).toBe(true);
  });
});
