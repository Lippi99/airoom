import { useReducer } from 'react';

/** What JS knows about the AR scene. Poses live natively; JS only tracks ids. */
export interface SceneItem {
  instanceId: string;
  productId: string;
}

export interface SceneState {
  items: SceneItem[];
  selectedId: string | null;
  /** Instance being downloaded/placed, if any. */
  placingId: string | null;
}

export type SceneAction =
  | { type: 'placeStarted'; instanceId: string }
  | { type: 'placeSucceeded'; item: SceneItem }
  | { type: 'placeFailed'; instanceId: string }
  | { type: 'removed'; instanceId: string }
  | { type: 'cleared' }
  | { type: 'selected'; instanceId: string | null };

export const initialSceneState: SceneState = { items: [], selectedId: null, placingId: null };

export function sceneReducer(state: SceneState, action: SceneAction): SceneState {
  switch (action.type) {
    case 'placeStarted':
      return { ...state, placingId: action.instanceId };
    case 'placeSucceeded': {
      const exists = state.items.some((i) => i.instanceId === action.item.instanceId);
      return {
        ...state,
        items: exists ? state.items : [...state.items, action.item],
        placingId: state.placingId === action.item.instanceId ? null : state.placingId,
      };
    }
    case 'placeFailed':
      return {
        ...state,
        placingId: state.placingId === action.instanceId ? null : state.placingId,
        selectedId: state.selectedId === action.instanceId ? null : state.selectedId,
      };
    case 'removed':
      return {
        ...state,
        items: state.items.filter((i) => i.instanceId !== action.instanceId),
        selectedId: state.selectedId === action.instanceId ? null : state.selectedId,
      };
    case 'cleared':
      return { ...state, items: [], selectedId: null };
    case 'selected':
      return { ...state, selectedId: action.instanceId };
  }
}

export function useSceneState() {
  return useReducer(sceneReducer, initialSceneState);
}

let instanceCounter = 0;

/** Unique id for one placed copy of a product. */
export function newInstanceId(productId: string): string {
  instanceCounter += 1;
  return `${productId}:${Date.now().toString(36)}:${instanceCounter}`;
}
