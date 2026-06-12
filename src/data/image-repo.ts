import { getDB } from './database';

/**
 * 指定したIDで画像Blobデータを保存します。
 */
export async function saveImage(id: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('images', { id, blob });
}

/**
 * 指定したIDの画像Blobデータを取得します。
 */
export async function getImage(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  const result = await db.get('images', id);
  return result?.blob;
}

/**
 * 指定したIDの画像データを削除します。
 */
export async function deleteImage(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('images', id);
}

/**
 * 複数の画像データをバルクで復元（または保存）します（Undoなどで利用）。
 */
export async function restoreImages(images: Array<{ id: string; blob: Blob }>): Promise<void> {
  if (images.length === 0) return;
  const db = await getDB();
  const tx = db.transaction('images', 'readwrite');
  const store = tx.objectStore('images');
  for (const img of images) {
    await store.put(img);
  }
  await tx.done;
}
