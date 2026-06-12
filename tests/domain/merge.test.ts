import { describe, it, expect } from 'vitest';
import { mergeData, SyncData } from '../../src/domain/merge';
import { Page, MindMapNode, Edge, HistoryEntry } from '../../src/types';

describe('mergeData domain helper', () => {
  const createPage = (id: string, title: string, updatedAt: string): Page => ({
    pageId: id,
    title,
    createdAt: '2026-06-12T00:00:00Z',
    updatedAt,
  });

  const createNode = (id: string, text: string, updatedAt: string, imageRef = ''): MindMapNode => ({
    id,
    pageId: 'page1',
    text,
    position: { x: 0, y: 0 },
    media: {
      hasImage: !!imageRef,
      imageRef,
      hasAudio: false,
      audioRef: '',
    },
    createdAt: '2026-06-12T00:00:00Z',
    updatedAt,
  });

  it('should return local data with garbage collected images if cloud data is null', () => {
    const local: SyncData = {
      pages: [createPage('page1', 'Local Page', '2026-06-12T01:00:00Z')],
      nodes: [
        createNode('node1', 'Node 1', '2026-06-12T01:00:00Z', 'img-node1'),
        createNode('node2', 'Node 2 (No Image)', '2026-06-12T01:00:00Z'),
      ],
      edges: [],
      history: [],
      images: [
        { id: 'img-node1', data: 'data1' },
        { id: 'img-node2-orphan', data: 'data2' }, // 孤立した画像
      ],
    };

    const result = mergeData(local, null);

    expect(result.pages).toHaveLength(1);
    expect(result.nodes).toHaveLength(2);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].id).toBe('img-node1');
  });

  it('should resolve conflicts using updatedAt when local and cloud both have the same page/node', () => {
    const local: SyncData = {
      pages: [createPage('page1', 'Local Title (Older)', '2026-06-12T01:00:00Z')],
      nodes: [createNode('node1', 'Local Text (Newer)', '2026-06-12T02:00:00Z')],
      edges: [],
      history: [],
      images: [],
    };

    const cloud: SyncData = {
      pages: [createPage('page1', 'Cloud Title (Newer)', '2026-06-12T02:00:00Z')],
      nodes: [createNode('node1', 'Cloud Text (Older)', '2026-06-12T01:00:00Z')],
      edges: [],
      history: [],
      images: [],
    };

    const result = mergeData(local, cloud);

    // Page: cloud is newer, so cloud title is selected
    expect(result.pages[0].title).toBe('Cloud Title (Newer)');
    // Node: local is newer, so local text is selected
    expect(result.nodes[0].text).toBe('Local Text (Newer)');
  });

  it('should merge lists and garbage collect unreferenced images', () => {
    const local: SyncData = {
      pages: [createPage('page1', 'Page 1', '2026-06-12T01:00:00Z')],
      nodes: [createNode('node1', 'Node 1', '2026-06-12T01:00:00Z', 'img-node1')],
      edges: [],
      history: [],
      images: [{ id: 'img-node1', data: 'data1' }],
    };

    const cloud: SyncData = {
      pages: [createPage('page2', 'Page 2', '2026-06-12T01:00:00Z')],
      nodes: [
        // node1 updated in cloud to remove image ref
        createNode('node1', 'Node 1 (Updated)', '2026-06-12T02:00:00Z', ''),
        createNode('node2', 'Node 2', '2026-06-12T01:00:00Z', 'img-node2'),
      ],
      edges: [],
      history: [],
      images: [
        { id: 'img-node1', data: 'data1' },
        { id: 'img-node2', data: 'data2' },
      ],
    };

    const result = mergeData(local, cloud);

    // Both pages exist
    expect(result.pages).toHaveLength(2);
    // node1 (updated, no image) and node2 (has img-node2) exist
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.find((n) => n.id === 'node1')?.media.hasImage).toBe(false);

    // img-node1 is orphan because node1 no longer refers to it, but img-node2 is referenced by node2
    expect(result.images).toHaveLength(1);
    expect(result.images[0].id).toBe('img-node2');
  });
});
