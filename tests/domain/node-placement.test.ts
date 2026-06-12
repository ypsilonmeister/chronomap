import { describe, it, expect } from 'vitest';
import { calculateChildNodePosition, calculateSiblingNodePosition } from '../../src/domain/node-placement';
import { MindMapNode, Edge } from '../../src/types';

describe('node placement heuristics', () => {
  const rootNode: MindMapNode = {
    id: 'root',
    pageId: 'page1',
    text: 'Root',
    media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
    position: { x: 0, y: 0 },
    createdAt: '2026-06-12T00:00:00Z',
    updatedAt: '2026-06-12T00:00:00Z',
  };

  it('calculateChildNodePosition on root with no children should put it on the right side', () => {
    const nodes = [rootNode];
    const edges: Edge[] = [];
    const pos = calculateChildNodePosition('root', nodes, edges);
    expect(pos).not.toBeNull();
    // Default side is right (side = 1) -> x = 0 + 240 = 240
    expect(pos!.x).toBe(240);
    expect(pos!.y).toBe(0);
  });

  it('calculateChildNodePosition on root with 1 child on the right should place the next child on the left', () => {
    const child1: MindMapNode = {
      id: 'child1',
      pageId: 'page1',
      text: 'Child 1',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 240, y: 0 },
      createdAt: '2026-06-12T00:01:00Z',
      updatedAt: '2026-06-12T00:01:00Z',
    };
    const nodes = [rootNode, child1];
    const edges: Edge[] = [
      { id: 'e1', pageId: 'page1', source: 'root', target: 'child1', createdAt: '2026-06-12T00:01:00Z' },
    ];

    const pos = calculateChildNodePosition('root', nodes, edges);
    expect(pos).not.toBeNull();
    // Since right child count (1) > left child count (0), it goes left (side = -1) -> x = -240
    expect(pos!.x).toBe(-240);
    expect(pos!.y).toBe(0);
  });

  it('calculateChildNodePosition on non-root should place child on the same side', () => {
    const parentNode: MindMapNode = {
      id: 'parent',
      pageId: 'page1',
      text: 'Parent',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 240, y: 0 }, // located on the right side of root (0, 0)
      createdAt: '2026-06-12T00:01:00Z',
      updatedAt: '2026-06-12T00:01:00Z',
    };
    const nodes = [rootNode, parentNode];
    const edges: Edge[] = [
      { id: 'e1', pageId: 'page1', source: 'root', target: 'parent', createdAt: '2026-06-12T00:01:00Z' },
    ];

    const pos = calculateChildNodePosition('parent', nodes, edges);
    expect(pos).not.toBeNull();
    // Same side as parent (x = 240 > 0) -> side = 1 -> newX = 240 + 240 = 480
    expect(pos!.x).toBe(480);
    expect(pos!.y).toBe(0);
  });

  it('calculateSiblingNodePosition should return position 80px below the target node', () => {
    const node: MindMapNode = {
      id: 'node1',
      pageId: 'page1',
      text: 'Node 1',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 100, y: 150 },
      createdAt: '2026-06-12T00:00:00Z',
      updatedAt: '2026-06-12T00:00:00Z',
    };
    const nodes = [node];
    const pos = calculateSiblingNodePosition('node1', nodes);
    expect(pos).toEqual({ x: 100, y: 230 });
  });
});
