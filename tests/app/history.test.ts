import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdatePageTitleCommand, UpdateNodeColorCommand, AddNodeCommand } from '../../src/history';
import * as pageRepo from '../../src/data/page-repo';
import * as nodeRepo from '../../src/data/node-repo';
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

