import { describe, it, expect } from 'vitest';
import { generateMarkdownOutline } from '../../src/ui/export-import-controller';
import { mapHistoryPayload } from '../../src/data/page-repo';

describe('generateMarkdownOutline', () => {
  it('should generate markdown outline from nodes and edges', () => {
    const pageTitle = 'Test Note';
    const nodes = [
      { id: '1', text: 'Root theme' },
      { id: '2', text: 'Subtopic A' },
      { id: '3', text: 'Subtopic B' },
      { id: '4', text: 'Detail A1' }
    ];
    const edges = [
      { id: 'e1', source: '1', target: '2' },
      { id: 'e2', source: '1', target: '3' },
      { id: 'e3', source: '2', target: '4' }
    ];

    const result = generateMarkdownOutline(pageTitle, nodes, edges);
    
    expect(result).toContain('# Test Note\n');
    expect(result).toContain('- Root theme\n');
    expect(result).toContain('  - Subtopic A\n');
    expect(result).toContain('    - Detail A1\n');
    expect(result).toContain('  - Subtopic B\n');
  });

  it('should handle unformatted/disconnected nodes as fallback', () => {
    const pageTitle = 'Disconnected Test';
    const nodes = [
      { id: '1', text: 'Theme' },
      { id: '2', text: 'Floating thought' }
    ];
    const edges: any[] = [];

    const result = generateMarkdownOutline(pageTitle, nodes, edges);

    expect(result).toContain('# Disconnected Test\n');
    expect(result).toContain('- Theme\n');
    expect(result).toContain('- Floating thought\n');
  });
});

describe('mapHistoryPayload', () => {
  const nodeIdMap = new Map<string, string>([
    ['old-root', 'new-root'],
    ['old-child', 'new-child']
  ]);
  const newPageId = 'new-page-123';

  it('should map create_node history entry for single node', () => {
    const payload = {
      node: { id: 'old-root', text: 'Root theme', media: { hasImage: false, imageRef: '' } },
      parentNodeId: null
    };

    const result = mapHistoryPayload('create_node', payload, nodeIdMap, newPageId);

    expect(result.node.id).toBe('new-root');
    expect(result.node.pageId).toBe(newPageId);
    expect(result.parentNodeId).toBeNull();
  });

  it('should map create_node with child and parentNodeId', () => {
    const payload = {
      node: { id: 'old-child', text: 'Subtopic A', media: { hasImage: true, imageRef: 'img-old-child' } },
      parentNodeId: 'old-root'
    };

    const result = mapHistoryPayload('create_node', payload, nodeIdMap, newPageId);

    expect(result.node.id).toBe('new-child');
    expect(result.node.pageId).toBe(newPageId);
    expect(result.node.media.imageRef).toBe('img-new-child');
    expect(result.parentNodeId).toBe('new-root');
  });

  it('should map update_node payload', () => {
    const payload = {
      nodeId: 'old-child',
      text: 'New Text',
      color: 'blue',
      media: { hasImage: true, imageRef: 'img-old-child' }
    };

    const result = mapHistoryPayload('update_node', payload, nodeIdMap, newPageId);

    expect(result.nodeId).toBe('new-child');
    expect(result.color).toBe('blue');
    expect(result.media.imageRef).toBe('img-new-child');
  });

  it('should map delete_node payload with cascadeIds', () => {
    const payload = {
      nodeId: 'old-root',
      cascadeIds: ['old-root', 'old-child']
    };

    const result = mapHistoryPayload('delete_node', payload, nodeIdMap, newPageId);

    expect(result.nodeId).toBe('new-root');
    expect(result.cascadeIds).toContain('new-root');
    expect(result.cascadeIds).toContain('new-child');
  });

  it('should map move_node payload with positions list', () => {
    const payload = {
      positions: [
        ['old-root', { x: 10, y: 20 }],
        ['old-child', { x: 30, y: 40 }]
      ]
    };

    const result = mapHistoryPayload('move_node', payload, nodeIdMap, newPageId);

    expect(result.positions[0][0]).toBe('new-root');
    expect(result.positions[1][0]).toBe('new-child');
  });
});
