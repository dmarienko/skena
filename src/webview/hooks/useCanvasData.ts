/**
 * Canvas state management — holds the CanvasData + vault index,
 * exposes dispatch for updates from host messages and user interactions.
 */

import { useReducer, useCallback } from 'react';
import { CanvasData, CanvasNode, CanvasEdge, VaultEntry } from '../../shared/types';

interface CanvasState {
  canvas: CanvasData;
  canvasPath: string;
  vaultEntries: VaultEntry[];
  /** - set of URIs that need re-render due to underlying file change */
  dirtyUris: Set<string>;
}

type Action =
  | { type: 'SET_CANVAS';     canvas: CanvasData; canvasPath: string }
  | { type: 'SET_VAULT_INDEX'; entries: VaultEntry[] }
  | { type: 'FILE_CHANGED';   uri: string }
  | { type: 'UPDATE_NODE';    node: CanvasNode }
  | { type: 'ADD_NODE';       node: CanvasNode }
  | { type: 'DELETE_NODE';    id: string }
  | { type: 'ADD_EDGE';       edge: CanvasEdge }
  | { type: 'DELETE_EDGE';    id: string }
  | { type: 'CLEAR_DIRTY';    uri: string };

const initial: CanvasState = {
  canvas:       { nodes: [], edges: [] },
  canvasPath:   '',
  vaultEntries: [],
  dirtyUris:    new Set(),
};

function reducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case 'SET_CANVAS':
      return { ...state, canvas: action.canvas, canvasPath: action.canvasPath, dirtyUris: new Set() };

    case 'SET_VAULT_INDEX':
      return { ...state, vaultEntries: action.entries };

    case 'FILE_CHANGED': {
      const next = new Set(state.dirtyUris);
      next.add(action.uri);
      return { ...state, dirtyUris: next };
    }

    case 'UPDATE_NODE': {
      const nodes = state.canvas.nodes.map(n => n.id === action.node.id ? action.node : n);
      return { ...state, canvas: { ...state.canvas, nodes } };
    }

    case 'ADD_NODE': {
      const nodes = [...state.canvas.nodes, action.node];
      return { ...state, canvas: { ...state.canvas, nodes } };
    }

    case 'DELETE_NODE': {
      const nodes  = state.canvas.nodes.filter(n => n.id !== action.id);
      // - also remove edges connected to this node
      const edges  = state.canvas.edges.filter(e => e.fromNode !== action.id && e.toNode !== action.id);
      return { ...state, canvas: { ...state.canvas, nodes, edges } };
    }

    case 'ADD_EDGE': {
      const edges = [...state.canvas.edges, action.edge];
      return { ...state, canvas: { ...state.canvas, edges } };
    }

    case 'DELETE_EDGE': {
      const edges = state.canvas.edges.filter(e => e.id !== action.id);
      return { ...state, canvas: { ...state.canvas, edges } };
    }

    case 'CLEAR_DIRTY': {
      const next = new Set(state.dirtyUris);
      next.delete(action.uri);
      return { ...state, dirtyUris: next };
    }
  }
}

export function useCanvasData() {
  const [state, dispatch] = useReducer(reducer, initial);

  return {
    canvas:       state.canvas,
    canvasPath:   state.canvasPath,
    vaultEntries: state.vaultEntries,
    dirtyUris:    state.dirtyUris,
    dispatch,
  };
}
