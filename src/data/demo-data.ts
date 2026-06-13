import { generateUUID } from './database';
import { Page, MindMapNode, Edge, HistoryEntry } from '../types';
import { IDBPDatabase } from 'idb';

/**
 * 初回起動時のリッチなデモページ（ようこそノート）を作成します。
 * 各ノードとエッジに異なる作成日時を割り当て、タイムライン再生を可能にします。
 */
export async function createWelcomeDemoPage(db: IDBPDatabase): Promise<string> {
  const pageId = generateUUID();
  const now = new Date();
  
  // 過去の時点から作成を開始して自然な履歴に見せる (現在時刻から5分前を起点とする)
  const baseTimeMs = now.getTime() - 5 * 60 * 1000;
  const getISOStr = (offsetSeconds: number) => {
    return new Date(baseTimeMs + offsetSeconds * 1000).toISOString();
  };

  // 1. ページデータの作成
  const page: Page = {
    pageId,
    title: 'ようこそ！ChronoMapデモ',
    createdAt: getISOStr(0),
    updatedAt: getISOStr(100),
  };

  // 各ノードのUUID生成
  const rootId = generateUUID();
  const n1Id = generateUUID();
  const n1_1Id = generateUUID();
  const n1_2Id = generateUUID();
  const n2Id = generateUUID();
  const n2_1Id = generateUUID();
  const n2_2Id = generateUUID();
  const n3Id = generateUUID();
  const n3_1Id = generateUUID();
  const n3_2Id = generateUUID();
  const n3_3Id = generateUUID();

  // 2. ノードデータの定義
  const nodes: MindMapNode[] = [
    {
      id: rootId,
      pageId,
      text: 'ChronoMapへようこそ！🚀',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 0, y: 0 },
      createdAt: getISOStr(0),
      updatedAt: getISOStr(0),
    },
    // ブランチA: 再生機能
    {
      id: n1Id,
      pageId,
      text: '思考の記録と再生 🎬',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: -260, y: -80 },
      color: 'blue',
      createdAt: getISOStr(10),
      updatedAt: getISOStr(10),
    },
    {
      id: n1_1Id,
      pageId,
      text: 'タイムラインを動かそう',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: -480, y: -140 },
      color: 'blue',
      createdAt: getISOStr(20),
      updatedAt: getISOStr(20),
    },
    {
      id: n1_2Id,
      pageId,
      text: '下の [再生] ボタンをクリック！',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: -480, y: -20 },
      color: 'blue',
      createdAt: getISOStr(30),
      updatedAt: getISOStr(30),
    },
    // ブランチB: メディア入力
    {
      id: n2Id,
      pageId,
      text: 'かんたんメディア入力 🎤',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 260, y: -80 },
      color: 'orange',
      createdAt: getISOStr(40),
      updatedAt: getISOStr(40),
    },
    {
      id: n2_1Id,
      pageId,
      text: '音声でメモができるよ',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 480, y: -140 },
      color: 'orange',
      createdAt: getISOStr(50),
      updatedAt: getISOStr(50),
    },
    {
      id: n2_2Id,
      pageId,
      text: '写真を貼り付けられるよ',
      media: {
        hasImage: true,
        imageRef: `img-${n2_2Id}`,
        hasAudio: false,
        audioRef: ''
      },
      position: { x: 480, y: 0 },
      color: 'orange',
      createdAt: getISOStr(60),
      updatedAt: getISOStr(60),
    },
    // ブランチC: 操作説明
    {
      id: n3Id,
      pageId,
      text: '直感的な操作 💡',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 0, y: 180 },
      color: 'green',
      createdAt: getISOStr(70),
      updatedAt: getISOStr(70),
    },
    {
      id: n3_1Id,
      pageId,
      text: 'Tabキーで子ノード追加',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: -200, y: 260 },
      color: 'green',
      createdAt: getISOStr(80),
      updatedAt: getISOStr(80),
    },
    {
      id: n3_2Id,
      pageId,
      text: 'Enterキーで兄弟ノード追加',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 0, y: 290 },
      color: 'green',
      createdAt: getISOStr(90),
      updatedAt: getISOStr(90),
    },
    {
      id: n3_3Id,
      pageId,
      text: '右クリック or ロングタップ',
      media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' },
      position: { x: 200, y: 260 },
      color: 'green',
      createdAt: getISOStr(100),
      updatedAt: getISOStr(100),
    }
  ];

  // 3. 接続線（エッジ）データの定義
  const edgeDefs = [
    { source: rootId, target: n1Id, time: 10 },
    { source: n1Id, target: n1_1Id, time: 20 },
    { source: n1Id, target: n1_2Id, time: 30 },
    { source: rootId, target: n2Id, time: 40 },
    { source: n2Id, target: n2_1Id, time: 50 },
    { source: n2Id, target: n2_2Id, time: 60 },
    { source: rootId, target: n3Id, time: 70 },
    { source: n3Id, target: n3_1Id, time: 80 },
    { source: n3Id, target: n3_2Id, time: 90 },
    { source: n3Id, target: n3_3Id, time: 100 }
  ];

  const edges: Edge[] = edgeDefs.map((def) => ({
    id: generateUUID(),
    pageId,
    source: def.source,
    target: def.target,
    createdAt: getISOStr(def.time),
    updatedAt: getISOStr(def.time)
  }));

  // 4. デモ用のSVG画像の定義
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250" width="400" height="250">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b" />
      <stop offset="100%" stop-color="#311042" />
    </linearGradient>
    <linearGradient id="glowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#818cf8" />
      <stop offset="100%" stop-color="#c084fc" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
  <rect width="100%" height="100%" fill="url(#bgGrad)" rx="12" />
  
  <line x1="200" y1="125" x2="100" y2="75" stroke="#4f46e5" stroke-width="3" stroke-dasharray="4 2" />
  <line x1="200" y1="125" x2="300" y2="75" stroke="#c084fc" stroke-width="3" />
  <line x1="200" y1="125" x2="200" y2="200" stroke="#10b981" stroke-width="3" />
  
  <circle cx="100" cy="75" r="20" fill="#1e293b" stroke="#818cf8" stroke-width="2" />
  <text x="100" y="80" font-family="sans-serif" font-size="14" fill="#e2e8f0" font-weight="bold" text-anchor="middle">Idea</text>
  
  <circle cx="300" cy="75" r="25" fill="#1e293b" stroke="#f472b6" stroke-width="2" />
  <text x="300" y="80" font-family="sans-serif" font-size="12" fill="#e2e8f0" font-weight="bold" text-anchor="middle">Play 🎬</text>
  
  <circle cx="200" cy="200" r="18" fill="#1e293b" stroke="#34d399" stroke-width="2" />
  <text x="200" y="204" font-family="sans-serif" font-size="12" fill="#e2e8f0" font-weight="bold" text-anchor="middle">Mic 🎤</text>

  <circle cx="200" cy="125" r="30" fill="url(#glowGrad)" filter="url(#glow)" />
  <text x="200" y="130" font-family="sans-serif" font-size="14" fill="#ffffff" font-weight="bold" text-anchor="middle">ChronoMap</text>
</svg>`;

  const demoBlob = new Blob([svgContent], { type: 'image/svg+xml' });

  // 5. 操作履歴データの作成 (再生順序の保証 & 同期用)
  const historyEntries: HistoryEntry[] = [];

  // ルートノードの作成
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(0),
    action: 'create_node',
    payload: { node: nodes[0], parentNodeId: null }
  });

  // ブランチA (思考の記録と再生) の作成
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(10),
    action: 'create_node',
    payload: { node: nodes[1], parentNodeId: rootId }
  });

  // ノードA-1
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(20),
    action: 'create_node',
    payload: { node: nodes[2], parentNodeId: n1Id }
  });

  // ノードA-2
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(30),
    action: 'create_node',
    payload: { node: nodes[3], parentNodeId: n1Id }
  });

  // ブランチB (かんたんメディア入力) の作成
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(40),
    action: 'create_node',
    payload: { node: nodes[4], parentNodeId: rootId }
  });

  // ノードB-1
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(50),
    action: 'create_node',
    payload: { node: nodes[5], parentNodeId: n2Id }
  });

  // ノードB-2 (最初は画像無しで作成され、その後画像が追加された履歴にする)
  const node2_2WithoutImage: MindMapNode = {
    ...nodes[6],
    media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' }
  };
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(60),
    action: 'create_node',
    payload: { node: node2_2WithoutImage, parentNodeId: n2Id }
  });
  
  // ノードB-2 への画像添付履歴
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(65),
    action: 'update_node',
    payload: {
      nodeId: n2_2Id,
      media: {
        hasImage: true,
        imageRef: `img-${n2_2Id}`
      }
    }
  });

  // ブランチC (直感的な操作) の作成
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(70),
    action: 'create_node',
    payload: { node: nodes[7], parentNodeId: rootId }
  });

  // ノードC-1
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(80),
    action: 'create_node',
    payload: { node: nodes[8], parentNodeId: n3Id }
  });

  // ノードC-2
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(90),
    action: 'create_node',
    payload: { node: nodes[9], parentNodeId: n3Id }
  });

  // ノードC-3
  historyEntries.push({
    entryId: generateUUID(),
    pageId,
    timestamp: getISOStr(100),
    action: 'create_node',
    payload: { node: nodes[10], parentNodeId: n3Id }
  });

  // 6. IndexedDB にデータをトランザクションで書き込む
  const tx = db.transaction(['pages', 'nodes', 'edges', 'images', 'history'], 'readwrite');
  
  await tx.objectStore('pages').put(page);
  
  const nodeStore = tx.objectStore('nodes');
  for (const node of nodes) {
    await nodeStore.put(node);
  }

  const edgeStore = tx.objectStore('edges');
  for (const edge of edges) {
    await edgeStore.put(edge);
  }

  await tx.objectStore('images').put({ id: `img-${n2_2Id}`, blob: demoBlob });

  const historyStore = tx.objectStore('history');
  for (const entry of historyEntries) {
    await historyStore.put(entry);
  }

  await tx.done;

  return pageId;
}
