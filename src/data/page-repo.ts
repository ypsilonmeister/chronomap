import { getDB, generateUUID } from './database';
import { Page, MindMapNode } from '../types';

/**
 * 新しいページ（ノート）を作成します。
 */
export async function createPage(title: string): Promise<Page> {
  const db = await getDB();
  const now = new Date().toISOString();
  const newPage: Page = {
    pageId: generateUUID(),
    title,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('pages', newPage);
  return newPage;
}

/**
 * 指定したIDのページ（論理削除されていないもの）を取得します。
 */
export async function getPage(pageId: string): Promise<Page | undefined> {
  const db = await getDB();
  const page = await db.get('pages', pageId);
  return page && !page.deleted ? page : undefined;
}

/**
 * 論理削除されていないすべてのページを取得し、更新日時の降順でソートします。
 */
export async function getAllPages(): Promise<Page[]> {
  const db = await getDB();
  const pages = await db.getAll('pages');
  return pages
    .filter((p) => !p.deleted)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/**
 * ページ情報を更新し、更新日時を現在時刻に設定します。
 */
export async function updatePage(pageId: string, updates: Partial<Omit<Page, 'pageId' | 'createdAt'>>): Promise<Page> {
  const db = await getDB();
  const tx = db.transaction('pages', 'readwrite');
  const store = tx.objectStore('pages');
  const page = await store.get(pageId);
  
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  const updatedPage = {
    ...page,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await store.put(updatedPage);
  await tx.done;
  return updatedPage;
}

/**
 * ページ本体と、紐づくすべてのノードおよびエッジを論理削除します。
 */
export async function deletePage(pageId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['pages', 'nodes', 'edges'], 'readwrite');
  const now = new Date().toISOString();
  
  // 1. ページ本体の論理削除
  const pageStore = tx.objectStore('pages');
  const page = await pageStore.get(pageId);
  if (page) {
    page.deleted = true;
    page.updatedAt = now;
    await pageStore.put(page);
  }

  // 2. ノードの論理削除
  const nodeStore = tx.objectStore('nodes');
  const nodeIndex = nodeStore.index('pageId');
  const nodes = await nodeIndex.getAll(pageId);
  for (const node of nodes) {
    node.deleted = true;
    node.updatedAt = now;
    await nodeStore.put(node);
  }

  // 3. エッジの論理削除
  const edgeStore = tx.objectStore('edges');
  const edgeIndex = edgeStore.index('pageId');
  const edges = await edgeIndex.getAll(pageId);
  for (const edge of edges) {
    edge.deleted = true;
    edge.updatedAt = now;
    await edgeStore.put(edge);
  }

  await tx.done;
}

/**
 * 指定したページを複製し、紐づくノード・エッジおよび画像データも複製します。
 */
export async function clonePage(pageId: string): Promise<Page> {
  const db = await getDB();
  const now = new Date().toISOString();
  
  const originalPage = await getPage(pageId);
  if (!originalPage) {
    throw new Error(`Page ${pageId} not found`);
  }

  const newPageId = generateUUID();
  const clonedPage: Page = {
    pageId: newPageId,
    title: `${originalPage.title} (コピー)`,
    createdAt: now,
    updatedAt: now,
  };

  const tx = db.transaction(['pages', 'nodes', 'edges', 'images'], 'readwrite');
  
  const nodeIndex = tx.objectStore('nodes').index('pageId');
  const originalNodes = (await nodeIndex.getAll(pageId)).filter((n) => !n.deleted);

  const edgeIndex = tx.objectStore('edges').index('pageId');
  const originalEdges = (await edgeIndex.getAll(pageId)).filter((e) => !e.deleted);

  const idMap = new Map<string, string>();
  const imageStore = tx.objectStore('images');
  const nodeStore = tx.objectStore('nodes');
  
  for (const node of originalNodes) {
    const newNodeId = generateUUID();
    idMap.set(node.id, newNodeId);

    const newMedia = { ...node.media };
    
    // 画像がある場合は複製
    if (node.media.hasImage && node.media.imageRef.startsWith('img-')) {
      const originalImage = await imageStore.get(node.media.imageRef);
      if (originalImage) {
        const newImageRef = `img-${newNodeId}`;
        newMedia.imageRef = newImageRef;
        await imageStore.put({
          id: newImageRef,
          blob: originalImage.blob
        });
      }
    }

    const clonedNode: MindMapNode = {
      ...node,
      id: newNodeId,
      pageId: newPageId,
      media: newMedia,
      createdAt: now,
      updatedAt: now,
    };
    await nodeStore.put(clonedNode);
  }

  const edgeStore = tx.objectStore('edges');
  for (const edge of originalEdges) {
    const newSource = idMap.get(edge.source);
    const newTarget = idMap.get(edge.target);

    if (newSource && newTarget) {
      const clonedEdge = {
        id: generateUUID(),
        pageId: newPageId,
        source: newSource,
        target: newTarget,
        createdAt: now,
        updatedAt: now,
      };
      await edgeStore.put(clonedEdge);
    }
  }

  await tx.objectStore('pages').put(clonedPage);
  await tx.done;
  return clonedPage;
}

/**
 * N+1問題を解消するため、全ページとそのページに含まれるノード数、テキスト情報を
 * 単一のトランザクションで一括ロードして要約リストを返します。
 */
export async function getPageSummaries(): Promise<Array<{ page: Page; nodeCount: number; nodeTexts: string[] }>> {
  const db = await getDB();
  const tx = db.transaction(['pages', 'nodes'], 'readonly');
  const pages = await tx.objectStore('pages').getAll();
  const nodes = await tx.objectStore('nodes').getAll();
  
  const nonDeletedPages = pages.filter((p) => !p.deleted);
  const nonDeletedNodes = nodes.filter((n) => !n.deleted);

  const pageNodesMap = new Map<string, MindMapNode[]>();
  for (const node of nonDeletedNodes) {
    let list = pageNodesMap.get(node.pageId);
    if (!list) {
      list = [];
      pageNodesMap.set(node.pageId, list);
    }
    list.push(node);
  }

  const summaries = nonDeletedPages.map((page) => {
    const pageNodes = pageNodesMap.get(page.pageId) || [];
    return {
      page,
      nodeCount: pageNodes.length,
      nodeTexts: pageNodes.map((n) => n.text)
    };
  });

  await tx.done;
  return summaries;
}

/**
 * ページの最終更新日時を明示的に更新します。
 */
export async function updatePageTimestamp(pageId: string, timestamp: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('pages', 'readwrite');
  const pageStore = tx.objectStore('pages');
  const page = await pageStore.get(pageId);
  if (page) {
    page.updatedAt = timestamp;
    await pageStore.put(page);
  }
  await tx.done;
}
