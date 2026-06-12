import { Page, MindMapNode, Edge, HistoryEntry } from '../types';

export interface SyncData {
  pages: Page[];
  nodes: MindMapNode[];
  edges: Edge[];
  history: HistoryEntry[];
  images: Array<{ id: string; data: string }>;
}

/**
 * 競合解消マージ処理 (updatedAt が新しい方を採用)
 */
export function mergeData(local: SyncData, cloud: SyncData | null): SyncData {
  if (!cloud) {
    // クラウドデータが無い場合でも、ローカルデータから孤立した画像を削除して返却する
    const activeImageRefs = new Set(
      local.nodes
        .filter((n) => !n.deleted && n.media.hasImage && n.media.imageRef)
        .map((n) => n.media.imageRef)
    );
    return {
      ...local,
      images: local.images.filter((img) => activeImageRefs.has(img.id))
    };
  }

  const merged: SyncData = {
    pages: mergeEntities(local.pages, cloud.pages, 'pageId'),
    nodes: mergeEntities(local.nodes, cloud.nodes, 'id'),
    edges: mergeEntities(local.edges, cloud.edges, 'id', true), // エッジも updatedAt 比較でマージ
    history: mergeEntities(local.history, cloud.history, 'entryId', false), // 履歴は entryId でマージ
    images: mergeImages(local.images, cloud.images),
  };

  // 画像データのガーベジコレクション (アクティブなノードから参照されていない画像を排除)
  const activeImageRefs = new Set(
    merged.nodes
      .filter((n) => !n.deleted && n.media.hasImage && n.media.imageRef)
      .map((n) => n.media.imageRef)
  );
  merged.images = merged.images.filter((img) => activeImageRefs.has(img.id));

  return merged;
}

/**
 * 汎用エンティティマージ (updatedAt 比較)
 */
function mergeEntities<T>(localList: T[], cloudList: T[], idKey: keyof T, useUpdatedAt = true): T[] {
  const map = new Map<any, T>();
  
  // まずローカルデータを格納
  for (const item of localList) {
    map.set(item[idKey], item);
  }

  // クラウドデータと比較しながらマージ
  for (const cloudItem of cloudList) {
    const id = cloudItem[idKey];
    const localItem = map.get(id);

    if (!localItem) {
      // クラウドにしか存在しない場合は追加
      map.set(id, cloudItem);
    } else if (useUpdatedAt) {
      // 両方にある場合は updatedAt を比較
      const localAny = localItem as any;
      const cloudAny = cloudItem as any;
      const localTime = new Date(localAny.updatedAt || localAny.createdAt || 0).getTime();
      const cloudTime = new Date(cloudAny.updatedAt || cloudAny.createdAt || 0).getTime();
      
      if (cloudTime > localTime) {
        map.set(id, cloudItem);
      }
    }
  }

  return Array.from(map.values());
}

/**
 * 画像ストアのマージ
 */
function mergeImages(localImages: any[], cloudImages: any[]): any[] {
  const map = new Map<string, any>();
  
  for (const img of localImages) {
    map.set(img.id, img);
  }
  
  // クラウド側画像で上書き/マージ (重複のない方を優先して取り込む)
  for (const cloudImg of cloudImages) {
    if (!map.has(cloudImg.id)) {
      map.set(cloudImg.id, cloudImg);
    }
  }

  return Array.from(map.values());
}
