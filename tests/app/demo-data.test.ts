import { describe, it, expect, vi } from 'vitest';
import { createWelcomeDemoPage } from '../../src/data/demo-data';

describe('createWelcomeDemoPage', () => {
  it('should write welcome page, nodes, edges, images, and history to the database', async () => {
    const mockPut = vi.fn();
    const mockStore = {
      put: mockPut,
    };
    const mockTransaction = vi.fn().mockReturnValue({
      objectStore: vi.fn().mockReturnValue(mockStore),
      done: Promise.resolve(),
    });
    const mockDb = {
      transaction: mockTransaction,
    } as any;

    const pageId = await createWelcomeDemoPage(mockDb);

    expect(pageId).toBeDefined();
    expect(mockTransaction).toHaveBeenCalledWith(
      ['pages', 'nodes', 'edges', 'images', 'history'],
      'readwrite'
    );
    
    // We expect:
    // - 1 page
    // - 11 nodes
    // - 10 edges
    // - 1 image
    // - 12 history entries (11 node creations, 1 node update/image attachment)
    const expectedCalls = 1 + 11 + 10 + 1 + 12;
    expect(mockPut).toHaveBeenCalledTimes(expectedCalls);
  });
});
