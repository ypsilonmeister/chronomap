import { getDB, generateUUID } from './database';
import { Edge } from '../types';
import { updatePageTimestamp } from './page-repo';

/**
 * 新しいエッジを作成し、紐づくページの更新日時も更新します。
 */
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
  await updatePageTimestamp(edge.pageId, now);
  return newEdge;
}

/**
 * 指定したページのすべての有効な（論理削除されていない）エッジを取得します。
 */
export async function getEdgesByPage(pageId: string): Promise<Edge[]> {
  const db = await getDB();
  const tx = db.transaction('edges', 'readonly');
  const index = tx.objectStore('edges').index('pageId');
  const edges = await index.getAll(pageId);
  return edges.filter((e) => !e.deleted);
}

/**
 * 指定したIDのエッジを論理削除し、紐づくページの更新日時も更新します。
 */
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
    
    const pageStore = tx.objectStore('pages');
    const page = await pageStore.get(edge.pageId);
    if (page) {
      page.updatedAt = now;
      await pageStore.put(page);
    }
  }
  await tx.done;
}

/**
 * 複数のエッジをバルクで復元します（Undoなどで利用）。
 */
export async function restoreEdges(edges: Edge[]): Promise<void> {
  if (edges.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(['edges', 'pages'], 'readwrite');
  const edgeStore = tx.objectStore('edges');
  const now = new Date().toISOString();

  for (const e of edges) {
    e.deleted = false;
    e.updatedAt = now;
    await edgeStore.put(e);
  }

  const pageStore = tx.objectStore('pages');
  const page = await pageStore.get(edges[0].pageId);
  if (page) {
    page.updatedAt = now;
    await pageStore.put(page);
  }
  await tx.done;
}

/**
 * エッジオブジェクトをそのままデータベースに保存（上書き）します。
 */
export async function putEdge(edge: Edge): Promise<void> {
  const db = await getDB();
  await db.put('edges', edge);
}

