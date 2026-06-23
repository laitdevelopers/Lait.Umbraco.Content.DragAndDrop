// Pure state machine for keyboard "grab & place" reordering. No DOM access — the
// caller (dnd-host.ts) supplies the visible candidate rows and applies the
// resulting state to the indicator / move pipeline.

import type { DropZone } from './drop-zone';

export interface KbCandidate {
  unique: string;
  parentUnique: string | null;
  blocked: boolean; // cycle-guard: the source itself or one of its descendants
}

export interface KbState {
  sourceUnique: string;
  targetIndex: number;
  zone: DropZone; // 'before' | 'into' | 'after'
}

export type KbAction =
  | { type: 'none'; state: KbState }
  | { type: 'commit'; state: KbState }
  | { type: 'cancel' };

function nextNonBlocked(from: number, dir: 1 | -1, candidates: KbCandidate[]): number {
  let i = from + dir;
  while (i >= 0 && i < candidates.length) {
    if (!candidates[i].blocked) return i;
    i += dir;
  }
  return from; // clamp: no non-blocked candidate in that direction
}

export function reduceKey(state: KbState, key: string, candidates: KbCandidate[]): KbAction {
  switch (key) {
    case 'ArrowDown':
      return { type: 'none', state: { ...state, targetIndex: nextNonBlocked(state.targetIndex, 1, candidates), zone: 'before' } };
    case 'ArrowUp':
      return { type: 'none', state: { ...state, targetIndex: nextNonBlocked(state.targetIndex, -1, candidates), zone: 'before' } };
    case 'ArrowRight':
      return { type: 'none', state: { ...state, zone: 'into' } };
    case 'ArrowLeft': {
      const parentUnique = candidates[state.targetIndex]?.parentUnique ?? null;
      if (!parentUnique) return { type: 'none', state };
      const parentIndex = candidates.findIndex((c) => c.unique === parentUnique);
      if (parentIndex < 0) return { type: 'none', state };
      return { type: 'none', state: { ...state, targetIndex: parentIndex, zone: 'after' } };
    }
    case ' ':
    case 'Enter': {
      const target = candidates[state.targetIndex];
      if (!target || target.blocked) return { type: 'none', state };
      return { type: 'commit', state };
    }
    case 'Escape':
      return { type: 'cancel' };
    default:
      return { type: 'none', state };
  }
}
