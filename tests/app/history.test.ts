import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdatePageTitleCommand, UpdateNodeColorCommand, AddNodeCommand, InsertNodeOnEdgeCommand, DeleteNodeCommand } from '../../src/history';
import * as pageRepo from '../../src/data/page-repo';
import * as nodeRepo from '../../src/data/node-repo';
import * as edgeRepo from '../../src/data/edge-repo';
import * as eventlogRepo from '../../src/data/eventlog-repo';

vi.mock('../../src/data/page-repo', () => ({
  getPage: vi.fn(),
  updatePage: vi.fn(),
}));

vi.mock('../../src/data/eventlog-repo', () => ({
  addHistory: vi.fn(),
}));

vi.mock('../../src/data/node-repo', () => ({
  getNode: vi.fn(),
  updateNode: vi.fn(),
  createNode: vi.fn(),
  putNode: vi.fn(),
  deleteNode: vi.fn(),
  cascadeSoftDelete: vi.fn(),
  restoreNodes: vi.fn(),
}));

vi.mock('../../src/data/edge-repo', () => ({
  createEdge: vi.fn(),
  deleteEdge: vi.fn(),
  restoreEdges: vi.fn(),
  putEdge: vi.fn(),
  getEdgesByPage: vi.fn(),
}));


vi.mock('../../src/app/store', () => ({
  store: {
    getState: () => ({ currentPageId: 'page1' }),
    reloadPages: vi.fn(),
    reloadPageData: vi.fn(),
  },
}));

describe('UpdatePageTitleCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should execute and rename the page title, then log history', async () => {
    const mockPage = { pageId: 'page1', title: 'Old Title', createdAt: '...', updatedAt: '...' };
    vi.mocked(pageRepo.getPage).mockResolvedValue(mockPage as any);

    const command = new UpdatePageTitleCommand('page1', 'New Title');
    await command.execute();

    expect(pageRepo.getPage).toHaveBeenCalledWith('page1');
    expect(pageRepo.updatePage).toHaveBeenCalledWith('page1', { title: 'New Title' });
    expect(eventlogRepo.addHistory).toHaveBeenCalledWith(expect.objectContaining({
      pageId: 'page1',
      action: 'update_page_title',
      payload: { title: 'New Title' },
    }));
  });

  it('should undo and restore the original page title, then log history', async () => {
    const mockPage = { pageId: 'page1', title: 'Old Title', createdAt: '...', updatedAt: '...' };
    vi.mocked(pageRepo.getPage).mockResolvedValue(mockPage as any);

    const command = new UpdatePageTitleCommand('page1', 'New Title');
    
    // Execute first to capture the old title
    await command.execute();
    
    vi.clearAllMocks();
    vi.mocked(pageRepo.getPage).mockResolvedValue({ ...mockPage, title: 'New Title' } as any);

    await command.undo();

    expect(pageRepo.updatePage).toHaveBeenCalledWith('page1', { title: 'Old Title' });
    expect(eventlogRepo.addHistory).toHaveBeenCalledWith(expect.objectContaining({
      pageId: 'page1',
      action: 'update_page_title',
      payload: { title: 'Old Title' },
    }));
  });
});

describe('UpdateNodeColorCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should execute and update node color, then log history', async () => {
    const mockNode = { id: 'node1', pageId: 'page1', text: 'Theme', color: undefined, createdAt: '...', updatedAt: '...' };
    vi.mocked(nodeRepo.getNode).mockResolvedValue(mockNode as any);

    const command = new UpdateNodeColorCommand('node1', 'blue');
    await command.execute();

    expect(nodeRepo.getNode).toHaveBeenCalledWith('node1');
    expect(nodeRepo.updateNode).toHaveBeenCalledWith('node1', { color: 'blue' });
    expect(eventlogRepo.addHistory).toHaveBeenCalledWith(expect.objectContaining({
      pageId: 'page1',
      action: 'update_node',
      payload: { nodeId: 'node1', color: 'blue' },
    }));
  });

  it('should undo and restore the original node color, then log history', async () => {
    const mockNode = { id: 'node1', pageId: 'page1', text: 'Theme', color: 'blue', createdAt: '...', updatedAt: '...' };
    vi.mocked(nodeRepo.getNode).mockResolvedValue(mockNode as any);

    const command = new UpdateNodeColorCommand('node1', 'red');
    
    // Execute first to capture the old color ('blue')
    await command.execute();

    vi.clearAllMocks();
    vi.mocked(nodeRepo.getNode).mockResolvedValue({ ...mockNode, color: 'red' } as any);

    await command.undo();

    expect(nodeRepo.updateNode).toHaveBeenCalledWith('node1', { color: 'blue' });
    expect(eventlogRepo.addHistory).toHaveBeenCalledWith(expect.objectContaining({
      pageId: 'page1',
      action: 'update_node',
      payload: { nodeId: 'node1', color: 'blue' },
    }));
  });
});

describe('AddNodeCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('redo restores the node while preserving its original createdAt (timeline integrity)', async () => {
    const ORIGINAL_CREATED_AT = '2020-01-01T00:00:00.000Z';
    const media = { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' };
    const createdNode = {
      id: 'n1',
      pageId: 'page1',
      text: '新規ノード',
      media,
      position: { x: 0, y: 0 },
      createdAt: ORIGINAL_CREATED_AT,
      updatedAt: ORIGINAL_CREATED_AT,
    };
    vi.mocked(nodeRepo.createNode).mockResolvedValue(createdNode as any);

    const out = { node: null as any };
    const command = new AddNodeCommand(
      { pageId: 'page1', text: '新規ノード', media, position: { x: 0, y: 0 } } as any,
      null,
      out
    );

    await command.execute(); // 初回作成 (createNode 経由)
    await command.undo();     // 論理削除
    await command.execute();  // Redo (putNode 経由で復元)

    // Redo は putNode で復元する。createdAt は元の生成時刻のまま保持され、deleted は解除される。
    expect(nodeRepo.putNode).toHaveBeenCalledTimes(1);
    const restored = vi.mocked(nodeRepo.putNode).mock.calls[0][0];
    expect(restored.createdAt).toBe(ORIGINAL_CREATED_AT);
    expect(restored.deleted).toBe(false);
    // updatedAt は復元時刻に更新される（生成時刻とは別物）
    expect(restored.updatedAt).not.toBe(ORIGINAL_CREATED_AT);
  });
});

describe('InsertNodeOnEdgeCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should execute, soft-delete original edge, create new node and two new edges', async () => {
    const mockEdge = { id: 'edge1', pageId: 'page1', source: 'nodeA', target: 'nodeB', createdAt: '...', deleted: false };
    const mockNewNode = { id: 'nodeC', pageId: 'page1', text: '新規ノード', position: { x: 50, y: 50 }, createdAt: '...', updatedAt: '...' };
    const mockNewEdge1 = { id: 'newEdge1', pageId: 'page1', source: 'nodeA', target: 'nodeC', createdAt: '...' };
    const mockNewEdge2 = { id: 'newEdge2', pageId: 'page1', source: 'nodeC', target: 'nodeB', createdAt: '...' };

    vi.mocked(nodeRepo.createNode).mockResolvedValue(mockNewNode as any);
    vi.mocked(edgeRepo.createEdge)
      .mockResolvedValueOnce(mockNewEdge1 as any)
      .mockResolvedValueOnce(mockNewEdge2 as any);

    const out = { node: null as any };
    const command = new InsertNodeOnEdgeCommand(
      'page1',
      mockEdge as any,
      { x: 50, y: 50 },
      '新規ノード',
      out
    );

    await command.execute();

    // Verify original edge deleted
    expect(edgeRepo.deleteEdge).toHaveBeenCalledWith('edge1');
    expect(mockEdge.deleted).toBe(true);

    // Verify new node created
    expect(nodeRepo.createNode).toHaveBeenCalledWith(expect.objectContaining({
      pageId: 'page1',
      text: '新規ノード',
      position: { x: 50, y: 50 }
    }));
    expect(out.node).toBe(mockNewNode);

    // Verify new edges created
    expect(edgeRepo.createEdge).toHaveBeenNthCalledWith(1, {
      pageId: 'page1',
      source: 'nodeA',
      target: 'nodeC'
    });
    expect(edgeRepo.createEdge).toHaveBeenNthCalledWith(2, {
      pageId: 'page1',
      source: 'nodeC',
      target: 'nodeB'
    });

    // Verify history events
    expect(eventlogRepo.addHistory).toHaveBeenCalledTimes(3);
  });

  it('should undo and restore original edge and delete new node/edges', async () => {
    const mockEdge = { id: 'edge1', pageId: 'page1', source: 'nodeA', target: 'nodeB', createdAt: '...', deleted: false };
    const mockNewNode = { id: 'nodeC', pageId: 'page1', text: '新規ノード', position: { x: 50, y: 50 }, createdAt: '...', updatedAt: '...' };
    const mockNewEdge1 = { id: 'newEdge1', pageId: 'page1', source: 'nodeA', target: 'nodeC', createdAt: '...' };
    const mockNewEdge2 = { id: 'newEdge2', pageId: 'page1', source: 'nodeC', target: 'nodeB', createdAt: '...' };

    vi.mocked(nodeRepo.createNode).mockResolvedValue(mockNewNode as any);
    vi.mocked(edgeRepo.createEdge)
      .mockResolvedValueOnce(mockNewEdge1 as any)
      .mockResolvedValueOnce(mockNewEdge2 as any);

    const command = new InsertNodeOnEdgeCommand(
      'page1',
      mockEdge as any,
      { x: 50, y: 50 },
      '新規ノード'
    );

    await command.execute();

    vi.clearAllMocks();

    await command.undo();

    // Verify new node and edges deleted
    expect(edgeRepo.deleteEdge).toHaveBeenCalledWith('newEdge1');
    expect(edgeRepo.deleteEdge).toHaveBeenCalledWith('newEdge2');
    expect(nodeRepo.deleteNode).toHaveBeenCalledWith('nodeC');

    // Verify original edge restored
    expect(edgeRepo.restoreEdges).toHaveBeenCalledWith([mockEdge]);
    expect(mockEdge.deleted).toBe(false);

    // Verify history events
    expect(eventlogRepo.addHistory).toHaveBeenCalledTimes(2);
  });
});

describe('DeleteNodeCommand', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should cascade-delete if the node is a root node (no parent)', async () => {
    const mockNode = { id: 'rootNode', pageId: 'page1', text: 'Root theme', position: { x: 0, y: 0 } };
    vi.mocked(nodeRepo.getNode).mockResolvedValue(mockNode as any);
    vi.mocked(edgeRepo.getEdgesByPage).mockResolvedValue([]); // No edges on page
    vi.mocked(nodeRepo.cascadeSoftDelete).mockResolvedValue({
      deletedNodes: [mockNode],
      deletedEdges: [],
      deletedImages: []
    } as any);

    const command = new DeleteNodeCommand('rootNode');
    await command.execute();

    expect(nodeRepo.cascadeSoftDelete).toHaveBeenCalledWith('rootNode');
    expect(eventlogRepo.addHistory).toHaveBeenCalledWith(expect.objectContaining({
      pageId: 'page1',
      action: 'delete_node',
      payload: expect.objectContaining({
        nodeId: 'rootNode',
        cascadeIds: ['rootNode']
      })
    }));
  });

  it('should bypass-delete and reconnect parent to child if target is an intermediate node', async () => {
    const mockNode = { id: 'nodeB', pageId: 'page1', text: 'Intermediate', position: { x: 100, y: 100 }, deleted: false };
    const parentEdge = { id: 'edgeAB', pageId: 'page1', source: 'nodeA', target: 'nodeB', deleted: false };
    const childEdge = { id: 'edgeBC', pageId: 'page1', source: 'nodeB', target: 'nodeC', deleted: false };
    const newEdge = { id: 'edgeAC', pageId: 'page1', source: 'nodeA', target: 'nodeC', deleted: false };

    vi.mocked(nodeRepo.getNode).mockResolvedValue(mockNode as any);
    vi.mocked(edgeRepo.getEdgesByPage).mockResolvedValue([parentEdge, childEdge] as any);
    vi.mocked(edgeRepo.createEdge).mockResolvedValue(newEdge as any);

    const command = new DeleteNodeCommand('nodeB');
    await command.execute();

    // Check target node soft deleted
    expect(nodeRepo.putNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'nodeB', deleted: true }));

    // Check connected edges soft deleted
    expect(edgeRepo.putEdge).toHaveBeenCalledWith(expect.objectContaining({ id: 'edgeAB', deleted: true }));
    expect(edgeRepo.putEdge).toHaveBeenCalledWith(expect.objectContaining({ id: 'edgeBC', deleted: true }));

    // Check new bypass edge created from parent to child
    expect(edgeRepo.createEdge).toHaveBeenCalledWith({
      pageId: 'page1',
      source: 'nodeA',
      target: 'nodeC'
    });

    // Check eventlog logs delete_node and create_edge
    expect(eventlogRepo.addHistory).toHaveBeenCalledWith(expect.objectContaining({
      action: 'delete_node',
      payload: { nodeId: 'nodeB', cascadeIds: ['nodeB'] }
    }));
    expect(eventlogRepo.addHistory).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create_edge',
      payload: { edge: newEdge }
    }));

    // Test Undo
    vi.clearAllMocks();
    await command.undo();

    // Verify bypass edge deleted
    expect(edgeRepo.deleteEdge).toHaveBeenCalledWith('edgeAC');

    // Verify target node & original edges restored
    expect(nodeRepo.restoreNodes).toHaveBeenCalledWith([expect.objectContaining({ id: 'nodeB' })]);
    expect(edgeRepo.restoreEdges).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'edgeAB' }),
      expect.objectContaining({ id: 'edgeBC' })
    ]));
  });
});


