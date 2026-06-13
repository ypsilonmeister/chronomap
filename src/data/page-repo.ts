import { getDB, generateUUID } from './database';
import { Page, MindMapNode, Edge } from '../types';

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

/**
 * JSONデータから新しいページをインポートします。
 * 競合を避けるため、ページIDおよびノードID、エッジIDは新規に生成し直してマッピングします。
 */
export async function importPageJSON(jsonContent: string): Promise<string> {
  const data = JSON.parse(jsonContent);
  if (data.type !== 'chronomap-page-export' || !data.page || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('無効なファイルフォーマットです。ChronoMap のエクスポートデータではありません。');
  }

  const db = await getDB();
  const tx = db.transaction(['pages', 'nodes', 'edges', 'history', 'images'], 'readwrite');

  const newPageId = generateUUID();
  const now = new Date().toISOString();

  // 1. ページの保存 (タイトルに (インポート) を付与)
  const newPage: Page = {
    pageId: newPageId,
    title: `${data.page.title} (インポート)`,
    createdAt: now,
    updatedAt: now
  };
  await tx.objectStore('pages').put(newPage);

  // 2. ノードIDのマッピング作成
  const nodeIdMap = new Map<string, string>();
  for (const node of data.nodes) {
    nodeIdMap.set(node.id, generateUUID());
  }

  // 3. ノードの保存
  const nodeStore = tx.objectStore('nodes');
  const imageStore = tx.objectStore('images');
  for (const node of data.nodes) {
    const newNodeId = nodeIdMap.get(node.id)!;
    const newMedia = { ...node.media };
    
    // 画像データがある場合は復元
    if (node.media.hasImage && node.media.imageRef) {
      const oldImgRef = node.media.imageRef;
      const matchingImg = data.images?.find((img: any) => img.id === oldImgRef);
      if (matchingImg) {
        const newImgRef = `img-${newNodeId}`;
        newMedia.imageRef = newImgRef;
        
        // base64をBlobにデコードして画像ストアに保存
        const blob = base64ToBlob(matchingImg.data);
        await imageStore.put({ id: newImgRef, blob });
      }
    }

    const importedNode: MindMapNode = {
      ...node,
      id: newNodeId,
      pageId: newPageId,
      media: newMedia,
      createdAt: node.createdAt || now,
      updatedAt: node.updatedAt || now,
      deleted: false
    };
    await nodeStore.put(importedNode);
  }

  // 4. エッジの保存
  const edgeStore = tx.objectStore('edges');
  for (const edge of data.edges) {
    const newSource = nodeIdMap.get(edge.source);
    const newTarget = nodeIdMap.get(edge.target);
    if (newSource && newTarget) {
      const importedEdge: Edge = {
        ...edge,
        id: generateUUID(),
        pageId: newPageId,
        source: newSource,
        target: newTarget,
        createdAt: edge.createdAt || now,
        updatedAt: edge.updatedAt || now,
        deleted: false
      };
      await edgeStore.put(importedEdge);
    }
  }

  // 5. 操作履歴の保存とマッピング
  const historyStore = tx.objectStore('history');
  if (Array.isArray(data.histories)) {
    for (const h of data.histories) {
      const newPayload = mapHistoryPayload(h.action, h.payload, nodeIdMap, newPageId);
      const importedHistory = {
        ...h,
        entryId: generateUUID(),
        pageId: newPageId,
        timestamp: h.timestamp || now,
        payload: newPayload
      };
      delete (importedHistory as any).id; // 自動インクリメントキーは除外
      await historyStore.put(importedHistory);
    }
  }

  await tx.done;
  return newPageId;
}

// 履歴ペイロード内IDのマッピングヘルパー
export function mapHistoryPayload(action: string, payload: any, nodeIdMap: Map<string, string>, newPageId: string): any {
  if (!payload) return payload;
  const p = { ...payload };

  const mapNode = (node: any) => {
    const newNodeId = nodeIdMap.get(node.id) || generateUUID();
    nodeIdMap.set(node.id, newNodeId);
    const newMedia = { ...node.media };
    if (node.media?.hasImage && node.media?.imageRef?.startsWith('img-')) {
      newMedia.imageRef = `img-${newNodeId}`;
    }
    return {
      ...node,
      id: newNodeId,
      pageId: newPageId,
      media: newMedia
    };
  };

  const mapEdge = (edge: any) => {
    return {
      ...edge,
      id: generateUUID(),
      pageId: newPageId,
      source: nodeIdMap.get(edge.source) || edge.source,
      target: nodeIdMap.get(edge.target) || edge.target
    };
  };

  if (action === 'create_node') {
    if (p.node) {
      p.node = mapNode(p.node);
      p.parentNodeId = p.parentNodeId ? (nodeIdMap.get(p.parentNodeId) || p.parentNodeId) : null;
    } else if (Array.isArray(p.nodes)) {
      p.nodes = p.nodes.map(mapNode);
      if (Array.isArray(p.edges)) {
        p.edges = p.edges.map(mapEdge);
      }
    }
  } else if (action === 'update_node') {
    p.nodeId = nodeIdMap.get(p.nodeId) || p.nodeId;
    if (p.media?.imageRef?.startsWith('img-')) {
      p.media = { ...p.media, imageRef: `img-${p.nodeId}` };
    }
  } else if (action === 'delete_node') {
    p.nodeId = nodeIdMap.get(p.nodeId) || p.nodeId;
    if (Array.isArray(p.cascadeIds)) {
      p.cascadeIds = p.cascadeIds.map((id: string) => nodeIdMap.get(id) || id);
    }
  } else if (action === 'move_node') {
    if (p.nodeId) {
      p.nodeId = nodeIdMap.get(p.nodeId) || p.nodeId;
    } else if (Array.isArray(p.positions)) {
      p.positions = p.positions.map(([id, pos]: [string, any]) => [nodeIdMap.get(id) || id, pos]);
    }
  } else if (action === 'create_edge') {
    if (p.edge) {
      p.edge = mapEdge(p.edge);
    }
  }
  
  return p;
}

function base64ToBlob(base64: string, mimeType = 'image/jpeg'): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

