import { getDB, generateUUID } from './database';
import { MindMapNode, Edge, Position } from '../types';
import { updatePageTimestamp } from './page-repo';

/**
 * 新しいノードを作成し、紐づくページの更新日時も更新します。
 */
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
  await updatePageTimestamp(node.pageId, now);
  return newNode;
}

/**
 * 指定したページのすべての有効な（論理削除されていない）ノードを取得します。
 */
export async function getNodesByPage(pageId: string): Promise<MindMapNode[]> {
  const db = await getDB();
  const tx = db.transaction('nodes', 'readonly');
  const index = tx.objectStore('nodes').index('pageId');
  const nodes = await index.getAll(pageId);
  return nodes.filter((n) => !n.deleted);
}

/**
 * 指定したIDのノード情報を更新し、ページの更新日時も更新します。
 */
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
  
  const pageStore = tx.objectStore('pages');
  const page = await pageStore.get(node.pageId);
  if (page) {
    page.updatedAt = now;
    await pageStore.put(page);
  }

  await tx.done;
  return updatedNode;
}

/**
 * 指定したノードと、それに接続するすべてのエッジを論理削除します。
 */
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

/**
 * 指定したノードとそのすべての子孫ノード、接続するエッジ、画像データを再帰的に論理削除します。
 * 削除したデータを返却するため、Undoなどでそのまま復元データとして利用可能です。
 */
export async function cascadeSoftDelete(nodeId: string): Promise<{
  deletedNodes: MindMapNode[];
  deletedEdges: Edge[];
  deletedImages: Array<{ id: string; blob: Blob }>;
}> {
  const db = await getDB();
  
  // まず削除対象のノードを取得して pageId を特定
  const firstNode = await db.get('nodes', nodeId);
  if (!firstNode || firstNode.deleted) {
    return { deletedNodes: [], deletedEdges: [], deletedImages: [] };
  }
  const pageId = firstNode.pageId;

  // インメモリ探索用に、ページ内の全ノードとエッジをフェッチ (N+1クエリ・ロック競合の回避)
  const nodeIndex = db.transaction('nodes', 'readonly').objectStore('nodes').index('pageId');
  const allNodes = (await nodeIndex.getAll(pageId)).filter((n) => !n.deleted);

  const edgeIndex = db.transaction('edges', 'readonly').objectStore('edges').index('pageId');
  const allEdges = (await edgeIndex.getAll(pageId)).filter((e) => !e.deleted);

  const toDeleteNodeIds = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    toDeleteNodeIds.add(currentId);

    const children = allEdges
      .filter((e) => e.source === currentId)
      .map((e) => e.target);
    
    for (const childId of children) {
      if (!toDeleteNodeIds.has(childId)) {
        queue.push(childId);
      }
    }
  }

  const deletedNodes = allNodes.filter((n) => toDeleteNodeIds.has(n.id));
  const deletedEdges = allEdges.filter(
    (e) => toDeleteNodeIds.has(e.source) || toDeleteNodeIds.has(e.target)
  );

  const deletedImages: Array<{ id: string; blob: Blob }> = [];
  const now = new Date().toISOString();

  const tx = db.transaction(['nodes', 'edges', 'images', 'pages'], 'readwrite');
  const nodeStore = tx.objectStore('nodes');
  const edgeStore = tx.objectStore('edges');
  const imageStore = tx.objectStore('images');

  for (const n of deletedNodes) {
    n.deleted = true;
    n.updatedAt = now;
    await nodeStore.put(n);
    
    if (n.media.hasImage && n.media.imageRef.startsWith('img-')) {
      const imgObj = await imageStore.get(n.media.imageRef);
      if (imgObj) {
        deletedImages.push({
          id: n.media.imageRef,
          blob: imgObj.blob
        });
        await imageStore.delete(n.media.imageRef);
      }
    }
  }

  for (const e of deletedEdges) {
    e.deleted = true;
    e.updatedAt = now;
    await edgeStore.put(e);
  }

  // ページの更新日時を更新
  const pageStore = tx.objectStore('pages');
  const page = await pageStore.get(pageId);
  if (page) {
    page.updatedAt = now;
    await pageStore.put(page);
  }

  await tx.done;

  return {
    deletedNodes,
    deletedEdges,
    deletedImages
  };
}

/**
 * 複数のノードをバルクで復元します（Undoなどで利用）。
 */
export async function restoreNodes(nodes: MindMapNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(['nodes', 'pages'], 'readwrite');
  const nodeStore = tx.objectStore('nodes');
  const now = new Date().toISOString();
  
  for (const n of nodes) {
    n.deleted = false;
    n.updatedAt = now;
    await nodeStore.put(n);
  }

  const pageStore = tx.objectStore('pages');
  const page = await pageStore.get(nodes[0].pageId);
  if (page) {
    page.updatedAt = now;
    await pageStore.put(page);
  }
  await tx.done;
}

/**
 * 指定したIDのノードを取得します（論理削除されていないもの、または履歴管理用ならすべて）。
 */
export async function getNode(id: string): Promise<MindMapNode | undefined> {
  const db = await getDB();
  const node = await db.get('nodes', id);
  return node && !node.deleted ? node : undefined;
}

/**
 * ノードオブジェクトをそのままデータベースに保存（上書き）します。
 */
export async function putNode(node: MindMapNode): Promise<void> {
  const db = await getDB();
  await db.put('nodes', node);
}

/**
 * 複数のノードの位置を一括更新します。
 */
export async function updateNodePositions(positions: Array<[string, Position]>): Promise<void> {
  if (positions.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(['nodes', 'pages'], 'readwrite');
  const nodeStore = tx.objectStore('nodes');
  const now = new Date().toISOString();
  
  let firstNodePageId: string | null = null;
  for (const [nodeId, pos] of positions) {
    const node = await nodeStore.get(nodeId);
    if (node) {
      if (!firstNodePageId) {
        firstNodePageId = node.pageId;
      }
      node.position = { ...pos };
      node.updatedAt = now;
      await nodeStore.put(node);
    }
  }

  if (firstNodePageId) {
    const pageStore = tx.objectStore('pages');
    const page = await pageStore.get(firstNodePageId);
    if (page) {
      page.updatedAt = now;
      await pageStore.put(page);
    }
  }

  await tx.done;
}


