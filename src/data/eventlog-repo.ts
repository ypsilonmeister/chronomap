import { getDB, generateUUID } from './database';
import { HistoryEntry } from '../types';

/**
 * タイムライン再生用の操作履歴（HistoryEntry）を追加します。
 * entryId は自動生成されます。
 */
export async function addHistory(entry: Omit<HistoryEntry, 'id' | 'entryId'>): Promise<void> {
  const db = await getDB();
  const newEntry = {
    ...entry,
    entryId: generateUUID()
  } as HistoryEntry;
  await db.put('history', newEntry);
}

/**
 * 指定したページの操作履歴を取得し、タイムスタンプ順（古い順）にソートして返します。
 */
export async function getHistoryByPage(pageId: string): Promise<HistoryEntry[]> {
  const db = await getDB();
  const tx = db.transaction('history', 'readonly');
  const index = tx.objectStore('history').index('pageId');
  const histories = await index.getAll(pageId);
  return histories.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
