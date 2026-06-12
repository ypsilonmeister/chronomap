import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdatePageTitleCommand } from '../../src/history';
import * as pageRepo from '../../src/data/page-repo';
import * as eventlogRepo from '../../src/data/eventlog-repo';

vi.mock('../../src/data/page-repo', () => ({
  getPage: vi.fn(),
  updatePage: vi.fn(),
}));

vi.mock('../../src/data/eventlog-repo', () => ({
  addHistory: vi.fn(),
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
