import { openDB, IDBPDatabase } from 'idb';
import { Page, MindMapNode, Edge, HistoryEntry } from './types';

// セキュアコンテキスト外（モバイルでのローカルネットワーク経由のHTTPなど）でも動作するように
// crypto.randomUUID() のフォールバックを持つUUIDジェネレータ
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const DB_NAME = 'chronomap-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // ページストア
        if (!db.objectStoreNames.contains('pages')) {
          const pageStore = db.createObjectStore('pages', { keyPath: 'pageId' });
          pageStore.createIndex('createdAt', 'createdAt');
          pageStore.createIndex('updatedAt', 'updatedAt');
          pageStore.createIndex('title', 'title');
        }

        // ノードストア
        if (!db.objectStoreNames.contains('nodes')) {
          const nodeStore = db.createObjectStore('nodes', { keyPath: 'id' });
          nodeStore.createIndex('pageId', 'pageId');
          nodeStore.createIndex('createdAt', 'createdAt');
        }

        // エッジストア
        if (!db.objectStoreNames.contains('edges')) {
          const edgeStore = db.createObjectStore('edges', { keyPath: 'id' });
          edgeStore.createIndex('pageId', 'pageId');
          edgeStore.createIndex('createdAt', 'createdAt');
        }

        // 画像Blobストア
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' });
        }

        // 操作履歴ストア（タイムライン再現用）
        if (!db.objectStoreNames.contains('history')) {
          const historyStore = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
          historyStore.createIndex('pageId', 'pageId');
          historyStore.createIndex('timestamp', 'timestamp');
        }
      },
    });
  }
  return dbPromise;
}

// ==========================================
// Page CRUD
// ==========================================

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

export async function getPage(pageId: string): Promise<Page | undefined> {
  const db = await getDB();
  const page = await db.get('pages', pageId);
  return page && !page.deleted ? page : undefined;
}

export async function getAllPages(): Promise<Page[]> {
  const db = await getDB();
  // 最終更新日時が新しい順にソートするデフォルト挙動
  const pages = await db.getAll('pages');
  return pages
    .filter((p) => !p.deleted)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

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

export async function clonePage(pageId: string): Promise<Page> {
  const db = await getDB();
  const now = new Date().toISOString();
  
  const originalPage = await getPage(pageId);
  if (!originalPage) {
    throw new Error(`Page ${pageId} not found`);
  }

  // 1. コピー先ページの生成
  const newPageId = generateUUID();
  const clonedPage: Page = {
    pageId: newPageId,
    title: `${originalPage.title} (コピー)`,
    createdAt: now,
    updatedAt: now,
  };

  // 2. オリジナルページの全ノード・エッジを取得
  const originalNodes = await getNodesByPage(pageId);
  const originalEdges = await getEdgesByPage(pageId);

  // IDのマッピングテーブル (オリジナルID -> 新しいID)
  const idMap = new Map<string, string>();
  const clonedNodes: MindMapNode[] = [];
  const clonedEdges: Edge[] = [];

  const tx = db.transaction(['pages', 'nodes', 'edges', 'images'], 'readwrite');
  
  // 新しいページレコードの挿入
  await tx.objectStore('pages').put(clonedPage);

  // ノードのクローン（画像がある場合は画像ストアのクローンも行う）
  const nodeStore = tx.objectStore('nodes');
  const imageStore = tx.objectStore('images');
  
  for (const node of originalNodes) {
    const newNodeId = generateUUID();
    idMap.set(node.id, newNodeId);

    const newMedia = { ...node.media };
    
    // 画像がある場合は複製
    if (node.media.hasImage && node.media.imageRef.startsWith('img-')) {
      const originalImage = await db.get('images', node.media.imageRef);
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
    clonedNodes.push(clonedNode);
    await nodeStore.put(clonedNode);
  }

  // エッジのクローン (ノードIDのマッピングを反映)
  const edgeStore = tx.objectStore('edges');
  for (const edge of originalEdges) {
    const newSource = idMap.get(edge.source);
    const newTarget = idMap.get(edge.target);

    if (newSource && newTarget) {
      const clonedEdge: Edge = {
        id: generateUUID(),
        pageId: newPageId,
        source: newSource,
        target: newTarget,
        createdAt: now,
      };
      clonedEdges.push(clonedEdge);
      await edgeStore.put(clonedEdge);
    }
  }

  await tx.done;
  return clonedPage;
}

// ==========================================
// Node CRUD
// ==========================================

export async function createNode(node: Omit<MindMapNode, 'id' | 'createdAt' | 'updatedAt'>): Promise<MindMapNode> {
  const db = await getDB();
  const now = new Date().toISOString();
  const newNode: MindMapNode = {
    ...node,
    id: generateUUID(),
    createdAt: now,
    updatedAt: now,
  };
  await db.put('nodes', newNode);
  
  // ページの最終更新日時も更新
  await updatePageTimestamp(node.pageId, now);
  
  return newNode;
}

export async function getNodesByPage(pageId: string): Promise<MindMapNode[]> {
  const db = await getDB();
  const tx = db.transaction('nodes', 'readonly');
  const index = tx.objectStore('nodes').index('pageId');
  const nodes = await index.getAll(pageId);
  return nodes.filter((n) => !n.deleted);
}

export async function updateNode(id: string, updates: Partial<Omit<MindMapNode, 'id' | 'pageId' | 'createdAt'>>): Promise<MindMapNode> {
  const db = await getDB();
  const tx = db.transaction(['nodes', 'pages'], 'readwrite');
  const nodeStore = tx.objectStore('nodes');
  const node = await nodeStore.get(id);

  if (!node) {
    throw new Error(`Node ${id} not found`);
  }

  const now = new Date().toISOString();
  const updatedNode = {
    ...node,
    ...updates,
    updatedAt: now,
  };

  await nodeStore.put(updatedNode);
  
  // ページの最終更新日時も更新
  const pageStore = tx.objectStore('pages');
  const page = await pageStore.get(node.pageId);
  if (page) {
    page.updatedAt = now;
    await pageStore.put(page);
  }

  await tx.done;
  return updatedNode;
}

export async function deleteNode(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['nodes', 'edges', 'pages'], 'readwrite');
  const nodeStore = tx.objectStore('nodes');
  const node = await nodeStore.get(id);

  if (!node) {
    await tx.done;
    return;
  }

  const now = new Date().toISOString();

  // 1. ノードを論理削除
  node.deleted = true;
  node.updatedAt = now;
  await nodeStore.put(node);

  // 2. 接続するエッジを論理削除
  const edgeStore = tx.objectStore('edges');
  const edges = await edgeStore.getAll();
  for (const edge of edges) {
    if (edge.source === id || edge.target === id) {
      edge.deleted = true;
      edge.updatedAt = now;
      await edgeStore.put(edge);
    }
  }

  // 3. ページ更新日時
  const pageStore = tx.objectStore('pages');
  const page = await pageStore.get(node.pageId);
  if (page) {
    page.updatedAt = now;
    await pageStore.put(page);
  }

  await tx.done;
}

// ==========================================
// Edge CRUD
// ==========================================

export async function createEdge(edge: Omit<Edge, 'id' | 'createdAt'>): Promise<Edge> {
  const db = await getDB();
  const now = new Date().toISOString();
  const newEdge: Edge = {
    ...edge,
    id: generateUUID(),
    createdAt: now,
    updatedAt: now,
  };
  await db.put('edges', newEdge);
  
  // ページの最終更新日時も更新
  await updatePageTimestamp(edge.pageId, now);

  return newEdge;
}

export async function getEdgesByPage(pageId: string): Promise<Edge[]> {
  const db = await getDB();
  const tx = db.transaction('edges', 'readonly');
  const index = tx.objectStore('edges').index('pageId');
  const edges = await index.getAll(pageId);
  return edges.filter((e) => !e.deleted);
}

export async function deleteEdge(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['edges', 'pages'], 'readwrite');
  const edgeStore = tx.objectStore('edges');
  const edge = await edgeStore.get(id);

  if (edge) {
    const now = new Date().toISOString();
    edge.deleted = true;
    edge.updatedAt = now;
    await edgeStore.put(edge);
    
    // ページの最終更新日時も更新
    const pageStore = tx.objectStore('pages');
    const page = await pageStore.get(edge.pageId);
    if (page) {
      page.updatedAt = now;
      await pageStore.put(page);
    }
  }
  await tx.done;
}

// ==========================================
// Image Storage
// ==========================================

export async function saveImage(id: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('images', { id, blob });
}

export async function getImage(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  const result = await db.get('images', id);
  return result?.blob;
}

export async function deleteImage(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('images', id);
}

// ==========================================
// History (Timeline & Playback)
// ==========================================

export async function addHistory(entry: Omit<HistoryEntry, 'id' | 'entryId'>): Promise<void> {
  const db = await getDB();
  const newEntry: HistoryEntry = {
    ...entry,
    entryId: generateUUID()
  };
  await db.put('history', newEntry);
}

export async function getHistoryByPage(pageId: string): Promise<HistoryEntry[]> {
  const db = await getDB();
  const tx = db.transaction('history', 'readonly');
  const index = tx.objectStore('history').index('pageId');
  const histories = await index.getAll(pageId);
  return histories.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// ==========================================
// Helper Functions
// ==========================================

async function updatePageTimestamp(pageId: string, timestamp: string): Promise<void> {
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
