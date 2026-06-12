export interface Page {
  pageId: string;       // UUIDv4
  title: string;
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
  deleted?: boolean;    // 論理削除フラグ
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
  deleted?: boolean;    // 論理削除フラグ
}

export interface Edge {
  id: string;           // UUIDv4
  pageId: string;       // ページID
  source: string;       // Node.id (親ノード)
  target: string;       // Node.id (子ノード)
  createdAt: string;    // ISO 8601
  updatedAt?: string;   // ISO 8601 (同期競合用)
  deleted?: boolean;    // 論理削除フラグ
}

export type HistoryPayloadMap = {
  create_node: { node: MindMapNode; parentNodeId: string | null } | { nodes: MindMapNode[]; edges: Edge[] };
  update_node: { nodeId: string; text?: string; media?: Partial<NodeMedia> };
  delete_node: { nodeId: string } | { nodeId: string; cascadeIds: string[] };
  move_node: { nodeId: string; position: Position } | { positions: [string, Position][] };
  update_page_title: { title: string };
  create_edge: { edge: Edge };
  delete_edge: { edgeId: string };
};

export type HistoryEntry = {
  id?: number;          // IndexedDB 自動インクリメントキー
  entryId: string;      // 同期時の名寄せ用ユニークID (UUIDv4)
  pageId: string;       // ページID
  timestamp: string;    // 操作時間 (ISO 8601)
} & {
  [K in keyof HistoryPayloadMap]: {
    action: K;
    payload: HistoryPayloadMap[K];
  };
}[keyof HistoryPayloadMap];

