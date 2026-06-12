import { describe, it, expect } from 'vitest';
import { runAutoLayout } from '../../src/domain/layout';
import { MindMapNode, Edge, Position } from '../../src/types';

describe('layout algorithm', () => {
  const rootNode: MindMapNode = {
    id: 'root',
    pageId: 'page1',
    text: 'Root',
    media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
    position: { x: 0, y: 0 },
    createdAt: '2026-06-12T00:00:00Z',
    updatedAt: '2026-06-12T00:00:00Z',
  };

  const child1: MindMapNode = {
    id: 'child1',
    pageId: 'page1',
    text: 'Child 1',
    media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
    position: { x: 0, y: 0 },
    createdAt: '2026-06-12T00:01:00Z',
    updatedAt: '2026-06-12T00:01:00Z',
  };

  const child2: MindMapNode = {
    id: 'child2',
    pageId: 'page1',
    text: 'Child 2',
    media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
    position: { x: 0, y: 0 },
    createdAt: '2026-06-12T00:02:00Z',
    updatedAt: '2026-06-12T00:02:00Z',
  };

  const nodes = [rootNode, child1, child2];
  const edges: Edge[] = [
    { id: 'e1', pageId: 'page1', source: 'root', target: 'child1', createdAt: '2026-06-12T00:01:00Z' },
    { id: 'e2', pageId: 'page1', source: 'root', target: 'child2', createdAt: '2026-06-12T00:02:00Z' },
  ];

  it('runAutoLayout should position root at (0, 0) and arrange children radially', () => {
    const outPositions = new Map<string, Position>();
    runAutoLayout(nodes, edges, rootNode, outPositions);

    // Root should be centered
    expect(outPositions.get('root')).toEqual({ x: 0, y: 0 });

    // Children should be placed at a distance
    const pos1 = outPositions.get('child1')!;
    const pos2 = outPositions.get('child2')!;

    expect(pos1).toBeDefined();
    expect(pos2).toBeDefined();

    // Verify distance from center (approx radiusStep = 240)
    const dist1 = Math.hypot(pos1.x, pos1.y);
    const dist2 = Math.hypot(pos2.x, pos2.y);
    expect(dist1).toBeCloseTo(240, 1);
    expect(dist2).toBeCloseTo(240, 1);

    // Verify radial spacing (angles should be diametrically opposed since 2 nodes are arranged in 360 degrees)
    // angle difference should be approx 180 degrees (Math.PI)
    const angle1 = Math.atan2(pos1.y, pos1.x);
    const angle2 = Math.atan2(pos2.y, pos2.x);
    let diff = Math.abs(angle1 - angle2);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    expect(diff).toBeCloseTo(Math.PI, 1);
  });
});
