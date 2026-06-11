import { MindMapNode, Edge, Position } from './types';
import * as db from './db';

// コマンドインターフェース
export interface Command {
  execute(): Promise<void>;
  undo(): Promise<void>;
}

// Undo/Redoスタックの管理クラス
export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private onStackChanged: () => void;

  constructor(onStackChanged: () => void) {
    this.onStackChanged = onStackChanged;
  }

  public async execute(command: Command) {
    await command.execute();
    this.undoStack.push(command);
    this.redoStack = []; // 新しい操作が行われたらRedoスタックはクリア
    this.onStackChanged();
  }

  public async undo() {
    const command = this.undoStack.pop();
    if (command) {
      await command.undo();
      this.redoStack.push(command);
      this.onStackChanged();
    }
  }

  public async redo() {
    const command = this.redoStack.pop();
    if (command) {
      await command.execute();
      this.undoStack.push(command);
      this.onStackChanged();
    }
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.onStackChanged();
  }
}

// ----------------------------------------------------
// 各種コマンドの実装
// ----------------------------------------------------

// 1. ノード追加コマンド
export class AddNodeCommand implements Command {
  constructor(
    private nodeData: Omit<MindMapNode, 'id' | 'createdAt' | 'updatedAt'>,
    private parentNodeId: string | null, // 親ノードID（ルートの場合はnull）
    private callback: () => void,
    private createdNodeOut?: { node: MindMapNode | null } // 作成されたノードID返却用
  ) {}

  private node: MindMapNode | null = null;
  private edge: Edge | null = null;

  async execute() {
    if (this.node) {
      // 2回目以降（Redo）は既存ノード・エッジの復元（元のIDを維持する）
      const now = new Date().toISOString();
      this.node.createdAt = now;
      this.node.updatedAt = now;
      const database = await db.getDB();
      await database.put('nodes', this.node);
      
      if (this.edge) {
        this.edge.createdAt = now;
        await database.put('edges', this.edge);
      }
    } else {
      const nodeObj: Omit<MindMapNode, 'id' | 'createdAt' | 'updatedAt'> = {
        ...this.nodeData
      };
      
      // ノード保存
      this.node = await db.createNode(nodeObj);
      
      // 戻り値設定
      if (this.createdNodeOut) {
        this.createdNodeOut.node = this.node;
      }

      // エッジの追加
      if (this.parentNodeId) {
        this.edge = await db.createEdge({
          pageId: this.node.pageId,
          source: this.parentNodeId,
          target: this.node.id
        });
      }

      // タイムライン再生用ログの保存
      await db.addHistory({
        pageId: this.node.pageId,
        timestamp: this.node.createdAt,
        action: 'create_node',
        payload: {
          node: this.node,
          parentNodeId: this.parentNodeId
        }
      });
    }

    this.callback();
  }

  async undo() {
    if (this.node) {
      // エッジ削除
      if (this.edge) {
        await db.deleteEdge(this.edge.id);
      }
      // ノード削除
      await db.deleteNode(this.node.id);

      // タイムライン再生用ログの保存 (Undoもログに残すことで再生の完全性を担保)
      await db.addHistory({
        pageId: this.node.pageId,
        timestamp: new Date().toISOString(),
        action: 'delete_node',
        payload: {
          nodeId: this.node.id
        }
      });
    }
    this.callback();
  }
}

// 2. ノード移動コマンド
export class MoveNodeCommand implements Command {
  private oldPos: Position;

  constructor(
    private nodeId: string,
    private newPos: Position,
    private callback: () => void
  ) {
    this.oldPos = { x: 0, y: 0 };
  }

  async execute() {
    const node = await db.getDB().then((dbInst) => dbInst.get('nodes', this.nodeId));
    if (node) {
      this.oldPos = { ...node.position };
      await db.updateNode(this.nodeId, { position: this.newPos });

      // タイムライン再生用ログの保存
      await db.addHistory({
        pageId: node.pageId,
        timestamp: new Date().toISOString(),
        action: 'move_node',
        payload: {
          nodeId: this.nodeId,
          position: this.newPos
        }
      });
    }
    this.callback();
  }

  async undo() {
    const node = await db.getDB().then((dbInst) => dbInst.get('nodes', this.nodeId));
    if (node) {
      await db.updateNode(this.nodeId, { position: this.oldPos });

      // タイムライン再生用ログの保存
      await db.addHistory({
        pageId: node.pageId,
        timestamp: new Date().toISOString(),
        action: 'move_node',
        payload: {
          nodeId: this.nodeId,
          position: this.oldPos
        }
      });
    }
    this.callback();
  }
}

// 3. テキスト編集コマンド
export class UpdateNodeTextCommand implements Command {
  private oldText = '';

  constructor(
    private nodeId: string,
    private newText: string,
    private callback: () => void
  ) {}

  async execute() {
    const node = await db.getDB().then((dbInst) => dbInst.get('nodes', this.nodeId));
    if (node) {
      this.oldText = node.text;
      await db.updateNode(this.nodeId, { text: this.newText });

      // タイムライン再生用ログの保存
      await db.addHistory({
        pageId: node.pageId,
        timestamp: new Date().toISOString(),
        action: 'update_node',
        payload: {
          nodeId: this.nodeId,
          text: this.newText
        }
      });
    }
    this.callback();
  }

  async undo() {
    const node = await db.getDB().then((dbInst) => dbInst.get('nodes', this.nodeId));
    if (node) {
      await db.updateNode(this.nodeId, { text: this.oldText });

      // タイムライン再生用ログの保存
      await db.addHistory({
        pageId: node.pageId,
        timestamp: new Date().toISOString(),
        action: 'update_node',
        payload: {
          nodeId: this.nodeId,
          text: this.oldText
        }
      });
    }
    this.callback();
  }
}

// 4. ノード削除コマンド（配下子ノードも一括）
export class DeleteNodeCommand implements Command {
  private deletedNodes: MindMapNode[] = [];
  private deletedEdges: Edge[] = [];
  private deletedImages: Array<{ id: string; blob: Blob }> = [];
  private pageId = '';

  constructor(
    private targetNodeId: string,
    private callback: () => void
  ) {}

  async execute() {
    const database = await db.getDB();
    const node = await database.get('nodes', this.targetNodeId);
    if (!node) return;
    
    this.pageId = node.pageId;

    // 削除対象のノードと接続されているエッジを再帰的に収集
    const allNodes = await db.getNodesByPage(this.pageId);
    const allEdges = await db.getEdgesByPage(this.pageId);

    const toDeleteNodeIds = new Set<string>();
    const queue = [this.targetNodeId];

    // 再帰的に子孫を検索
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      toDeleteNodeIds.add(currentId);

      // 子ノードを見つける
      const children = allEdges
        .filter((e) => e.source === currentId)
        .map((e) => e.target);
      
      for (const childId of children) {
        if (!toDeleteNodeIds.has(childId)) {
          queue.push(childId);
        }
      }
    }

    // 削除するノードの収集
    this.deletedNodes = allNodes.filter((n) => toDeleteNodeIds.has(n.id));
    
    // 削除するエッジの収集 (両端のいずれかが削除対象ノードに接続されている場合)
    this.deletedEdges = allEdges.filter(
      (e) => toDeleteNodeIds.has(e.source) || toDeleteNodeIds.has(e.target)
    );

    // 画像データの収集と削除
    const tx = database.transaction(['nodes', 'edges', 'images', 'pages'], 'readwrite');
    const nodeStore = tx.objectStore('nodes');
    const edgeStore = tx.objectStore('edges');
    const imageStore = tx.objectStore('images');

    for (const n of this.deletedNodes) {
      await nodeStore.delete(n.id);
      
      if (n.media.hasImage && n.media.imageRef.startsWith('img-')) {
        const imgObj = await imageStore.get(n.media.imageRef);
        if (imgObj) {
          this.deletedImages.push({
            id: n.media.imageRef,
            blob: imgObj.blob
          });
          await imageStore.delete(n.media.imageRef);
        }
      }
    }

    for (const e of this.deletedEdges) {
      await edgeStore.delete(e.id);
    }

    // ページ更新日時
    const pageStore = tx.objectStore('pages');
    const page = await pageStore.get(this.pageId);
    if (page) {
      page.updatedAt = new Date().toISOString();
      await pageStore.put(page);
    }

    await tx.done;

    // タイムライン再生用ログの保存
    await db.addHistory({
      pageId: this.pageId,
      timestamp: new Date().toISOString(),
      action: 'delete_node',
      payload: {
        nodeId: this.targetNodeId,
        cascadeIds: Array.from(toDeleteNodeIds)
      }
    });

    this.callback();
  }

  async undo() {
    const database = await db.getDB();
    const tx = database.transaction(['nodes', 'edges', 'images', 'pages'], 'readwrite');
    
    // 画像の復元
    const imageStore = tx.objectStore('images');
    for (const img of this.deletedImages) {
      await imageStore.put(img);
    }

    // ノードの復元
    const nodeStore = tx.objectStore('nodes');
    for (const n of this.deletedNodes) {
      await nodeStore.put(n);
    }

    // エッジの復元
    const edgeStore = tx.objectStore('edges');
    for (const e of this.deletedEdges) {
      await edgeStore.put(e);
    }

    // ページ更新日時
    const pageStore = tx.objectStore('pages');
    const page = await pageStore.get(this.pageId);
    if (page) {
      page.updatedAt = new Date().toISOString();
      await pageStore.put(page);
    }

    await tx.done;

    // タイムライン再生用ログの保存
    await db.addHistory({
      pageId: this.pageId,
      timestamp: new Date().toISOString(),
      action: 'create_node',
      payload: {
        nodes: this.deletedNodes,
        edges: this.deletedEdges
      }
    });

    this.callback();
  }
}

// 5. 整列コマンド (Auto Layout)
export class AlignNodesCommand implements Command {
  private originalPositions = new Map<string, Position>();

  constructor(
    private pageId: string,
    private newPositions: Map<string, Position>,
    private callback: () => void
  ) {}

  async execute() {
    const database = await db.getDB();
    const tx = database.transaction('nodes', 'readwrite');
    const store = tx.objectStore('nodes');

    // 現在のノードをすべて取得して、古い座標を保存
    const allNodes = await db.getNodesByPage(this.pageId);
    for (const node of allNodes) {
      this.originalPositions.set(node.id, { ...node.position });
    }

    // 新しい座標を書き込み
    for (const [nodeId, pos] of this.newPositions.entries()) {
      const node = allNodes.find((n) => n.id === nodeId);
      if (node) {
        node.position = { ...pos };
        await store.put(node);
      }
    }
    await tx.done;

    // タイムライン再生用ログの保存
    await db.addHistory({
      pageId: this.pageId,
      timestamp: new Date().toISOString(),
      action: 'move_node',
      payload: {
        positions: Array.from(this.newPositions.entries())
      }
    });

    this.callback();
  }

  async undo() {
    const database = await db.getDB();
    const tx = database.transaction('nodes', 'readwrite');
    const store = tx.objectStore('nodes');

    const allNodes = await db.getNodesByPage(this.pageId);
    for (const [nodeId, pos] of this.originalPositions.entries()) {
      const node = allNodes.find((n) => n.id === nodeId);
      if (node) {
        node.position = { ...pos };
        await store.put(node);
      }
    }
    await tx.done;

    // タイムライン再生用ログの保存
    await db.addHistory({
      pageId: this.pageId,
      timestamp: new Date().toISOString(),
      action: 'move_node',
      payload: {
        positions: Array.from(this.originalPositions.entries())
      }
    });

    this.callback();
  }
}
