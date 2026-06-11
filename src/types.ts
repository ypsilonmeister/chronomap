export interface Page {
  pageId: string;       // UUIDv4
  title: string;
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
}

export interface NodeMedia {
  hasImage: boolean;
  imageRef: string;     // Local Blob URL or Google Drive FileID
  hasAudio: boolean;
  audioRef: string;     // Local Blob URL or Google Drive FileID
}

export interface Position {
  x: number;
  y: number;
}

export interface MindMapNode {
  id: string;           // UUIDv4
  pageId: string;       // ページID
  text: string;
  media: NodeMedia;
  position: Position;
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
}

export interface Edge {
  id: string;           // UUIDv4
  pageId: string;       // ページID
  source: string;       // Node.id (親ノード)
  target: string;       // Node.id (子ノード)
  createdAt: string;    // ISO 8601
}

export interface HistoryEntry {
  id?: number;          // IndexedDB 自動インクリメントキー
  pageId: string;       // ページID
  timestamp: string;    // 操作時間 (ISO 8601)
  action: 'create_node' | 'update_node' | 'delete_node' | 'create_edge' | 'delete_edge' | 'move_node' | 'update_page_title';
  payload: any;         // 各アクション用のデータ
}
