import { describe, it, expect } from 'vitest';
import { isRootNode, getChildren, findRootNode, collectSubtree } from '../../src/domain/graph';
import { MindMapNode, Edge } from '../../src/types';

describe('graph domain helpers', () => {
  const mockNodes: MindMapNode[] = [
    {
      id: 'root',
      pageId: 'page1',
      text: 'Root',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 0, y: 0 },
      createdAt: '2026-06-12T00:00:00Z',
      updatedAt: '2026-06-12T00:00:00Z',
    },
    {
      id: 'child1',
      pageId: 'page1',
      text: 'Child 1',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 100, y: 50 },
      createdAt: '2026-06-12T00:01:00Z',
      updatedAt: '2026-06-12T00:01:00Z',
    },
    {
      id: 'child2',
      pageId: 'page1',
      text: 'Child 2',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 100, y: -50 },
      createdAt: '2026-06-12T00:02:00Z',
      updatedAt: '2026-06-12T00:02:00Z',
    },
    {
      id: 'grandchild',
      pageId: 'page1',
      text: 'Grandchild',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 200, y: 50 },
      createdAt: '2026-06-12T00:03:00Z',
      updatedAt: '2026-06-12T00:03:00Z',
    },
  ];

  const mockEdges: Edge[] = [
    { id: 'edge1', pageId: 'page1', source: 'root', target: 'child1', createdAt: '2026-06-12T00:01:00Z' },
    { id: 'edge2', pageId: 'page1', source: 'root', target: 'child2', createdAt: '2026-06-12T00:02:00Z' },
    { id: 'edge3', pageId: 'page1', source: 'child1', target: 'grandchild', createdAt: '2026-06-12T00:03:00Z' },
  ];

  it('isRootNode should return true for root nodes and false for child nodes', () => {
    expect(isRootNode('root', mockEdges)).toBe(true);
    expect(isRootNode('child1', mockEdges)).toBe(false);
    expect(isRootNode('grandchild', mockEdges)).toBe(false);
  });

  it('getChildren should return list of child nodes', () => {
    const rootChildren = getChildren('root', mockNodes, mockEdges);
    expect(rootChildren).toHaveLength(2);
    expect(rootChildren.map((n) => n.id)).toContain('child1');
    expect(rootChildren.map((n) => n.id)).toContain('child2');

    const child1Children = getChildren('child1', mockNodes, mockEdges);
    expect(child1Children).toHaveLength(1);
    expect(child1Children[0].id).toBe('grandchild');

    const child2Children = getChildren('child2', mockNodes, mockEdges);
    expect(child2Children).toHaveLength(0);
  });

  it('findRootNode should find the root node without parent edge', () => {
    const root = findRootNode(mockNodes, mockEdges);
    expect(root).not.toBeNull();
    expect(root!.id).toBe('root');
  });

  it('collectSubtree should gather all child nodes and edges recursively', () => {
    const subtree = collectSubtree('child1', mockNodes, mockEdges);
    expect(subtree.nodes).toHaveLength(2);
    expect(subtree.nodes.map((n) => n.id)).toContain('child1');
    expect(subtree.nodes.map((n) => n.id)).toContain('grandchild');

    expect(subtree.edges).toHaveLength(1);
    expect(subtree.edges[0].id).toBe('edge3');

    const fullTree = collectSubtree('root', mockNodes, mockEdges);
    expect(fullTree.nodes).toHaveLength(4);
    expect(fullTree.edges).toHaveLength(3);
  });
});
