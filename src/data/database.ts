import { openDB, IDBPDatabase } from 'idb';
import { Page, MindMapNode, Edge, HistoryEntry } from '../types';

const DB_NAME = 'chronomap-db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * セキュアコンテキスト外でも動作する安全なUUIDジェネレータ。
 */
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

/**
 * IndexedDB データベースインスタンスの Promise を取得します。
 * 必要なストア（pages, nodes, edges, images, history）のセットアップとインデックス作成を含みます。
 */
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

/**
 * すべてのストアのデータを一括で取得します（同期用）。
 * また、HistoryEntry で entryId が無いレコードに対しては自動マイグレーション（UUID生成）を行います。
 */
export async function getAllDataForSync(): Promise<{
  pages: Page[];
  nodes: MindMapNode[];
  edges: Edge[];
  history: HistoryEntry[];
  images: Array<{ id: string; data: string }>;
}> {
  const db = await getDB();

  // 歴史エントリーのマイグレーション: entryIdがない場合に付与して保存
  const rawHistories = await db.getAll('history');
  const tx = db.transaction('history', 'readwrite');
  const historyStore = tx.objectStore('history');
  let migrated = false;
  for (const h of rawHistories) {
    if (!h.entryId) {
      h.entryId = generateUUID();
      await historyStore.put(h);
      migrated = true;
    }
  }
  if (migrated) {
    await tx.done;
  } else {
    await tx.abort();
  }

  // マイグレーション後のデータを取得
  const pages = await db.getAll('pages');
  const nodes = await db.getAll('nodes');
  const edges = await db.getAll('edges');
  const histories = await db.getAll('history');
  const rawImages = await db.getAll('images');

  const images: Array<{ id: string; data: string }> = [];
  for (const img of rawImages) {
    if (img.blob) {
      const base64 = await blobToBase64(img.blob);
      images.push({ id: img.id, data: base64 });
    }
  }

  return { pages, nodes, edges, history: histories, images };
}

/**
 * データベースのすべてのストアをクリアし、指定されたマージデータを書き込みます（同期用）。
 */
export async function restoreAllDataFromSync(data: {
  pages: Page[];
  nodes: MindMapNode[];
  edges: Edge[];
  history: HistoryEntry[];
  images: Array<{ id: string; data: string }>;
}): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['pages', 'nodes', 'edges', 'history', 'images'], 'readwrite');
  
  // pages
  const pageStore = tx.objectStore('pages');
  await pageStore.clear();
  for (const p of data.pages) {
    await pageStore.put(p);
  }

  // nodes (imageRef を img-nodeId に補正)
  const nodeStore = tx.objectStore('nodes');
  await nodeStore.clear();
  for (const n of data.nodes) {
    const nodeToPut = { ...n };
    if (nodeToPut.media.hasImage && !nodeToPut.media.imageRef.startsWith('img-')) {
      nodeToPut.media.imageRef = `img-${n.id}`;
    }
    await nodeStore.put(nodeToPut);
  }

  // edges
  const edgeStore = tx.objectStore('edges');
  await edgeStore.clear();
  for (const e of data.edges) {
    await edgeStore.put(e);
  }

  // history
  const historyStore = tx.objectStore('history');
  await historyStore.clear();
  for (const h of data.history) {
    await historyStore.put(h);
  }

  // images
  const imageStore = tx.objectStore('images');
  await imageStore.clear();
  for (const img of data.images) {
    const blob = base64ToBlob(img.data);
    await imageStore.put({ id: img.id, blob });
  }

  await tx.done;
}

// 内部ユーティリティ
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
