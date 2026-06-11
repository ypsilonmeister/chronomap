# データモデルルール (data_model.md)

本プロジェクトにおける IndexedDB に格納するエンティティのスキーマ定義です。
TypeScript の型定義 (`src/types.ts`) はこのスキーマに厳密に準拠すること。

## 1. Page エンティティ
```typescript
interface Page {
  pageId: string;       // UUIDv4
  title: string;
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
  nodes: Node[];
  edges: Edge[];
}
```

## 2. Node エンティティ
```typescript
interface Node {
  id: string;           // UUIDv4
  text: string;
  media: {
    hasImage: boolean;
    imageRef: string;   // Local Blob URL or Google Drive FileID
    hasAudio: boolean;
    audioRef: string;   // Local Blob URL or Google Drive FileID
  };
  position: {
    x: number;
    y: number;
  };
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
}
```

## 3. Edge エンティティ
```typescript
interface Edge {
  id: string;           // UUIDv4
  source: string;       // Node.id (親ノード)
  target: string;       // Node.id (子ノード)
  createdAt: string;    // ISO 8601
}
```

## 4. ID 生成
- すべてのエンティティの ID は `crypto.randomUUID()` で生成する UUIDv4 形式とする。
- 外部ライブラリ（uuid パッケージ等）は不要。ネイティブ API を優先する。
