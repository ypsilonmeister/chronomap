import { MindMapNode, Edge, Position } from './types';
import * as pageRepo from './data/page-repo';
import * as nodeRepo from './data/node-repo';
import * as edgeRepo from './data/edge-repo';
import * as imageRepo from './data/image-repo';
import * as eventlogRepo from './data/eventlog-repo';
import { store } from './app/store';

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
    await this.refreshStore(command);
  }

  public async undo() {
    const command = this.undoStack.pop();
    if (command) {
      await command.undo();
      this.redoStack.push(command);
      this.onStackChanged();
      await this.refreshStore(command);
    }
  }

  public async redo() {
    const command = this.redoStack.pop();
    if (command) {
      await command.execute();
      this.undoStack.push(command);
      this.onStackChanged();
      await this.refreshStore(command);
    }
  }

  // コマンド実行後に store を再読込する。ページ一覧に影響するコマンド
  // (タイトル変更) はページ一覧ごと、それ以外は現在ページのデータのみを更新する。
  private async refreshStore(command: Command) {
    const pageId = store.getState().currentPageId;
    if (!pageId) return;
    if (command instanceof UpdatePageTitleCommand) {
      await store.reloadPages(pageId);
    } else {
      await store.reloadPageData(pageId);
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
    private createdNodeOut?: { node: MindMapNode | null } // 作成されたノードID返却用
  ) {}

  private node: MindMapNode | null = null;
  private edge: Edge | null = null;

  async execute() {
    if (this.node) {
      // Redo: 既存ノード・エッジの復元。
      // createdAt はタイムライン上のノード出現時刻を決定するため、Redo では上書きせず
      // 元の生成時刻を保持する（上書きすると再生時に出現位置がずれる）。
      const now = new Date().toISOString();
      this.node.updatedAt = now;
      this.node.deleted = false;
      await nodeRepo.putNode(this.node);

      if (this.edge) {
        this.edge.updatedAt = now;
        this.edge.deleted = false;
        await edgeRepo.putEdge(this.edge);
      }
    } else {
      const nodeObj: Omit<MindMapNode, 'id' | 'createdAt' | 'updatedAt'> = {
        ...this.nodeData
      };
      
      this.node = await nodeRepo.createNode(nodeObj);
      
      if (this.createdNodeOut) {
        this.createdNodeOut.node = this.node;
      }

      if (this.parentNodeId) {
        this.edge = await edgeRepo.createEdge({
          pageId: this.node.pageId,
          source: this.parentNodeId,
          target: this.node.id
        });
      }

      await eventlogRepo.addHistory({
        pageId: this.node.pageId,
        timestamp: this.node.createdAt,
        action: 'create_node',
        payload: {
          node: this.node,
          parentNodeId: this.parentNodeId
        }
      });
    }
  }

  async undo() {
    if (this.node) {
      if (this.edge) {
        await edgeRepo.deleteEdge(this.edge.id);
      }
      await nodeRepo.deleteNode(this.node.id);

      await eventlogRepo.addHistory({
        pageId: this.node.pageId,
        timestamp: new Date().toISOString(),
        action: 'delete_node',
        payload: {
          nodeId: this.node.id
        }
      });
    }
  }
}

// 2. ノード移動コマンド
export class MoveNodeCommand implements Command {
  private oldPos: Position;

  constructor(
    private nodeId: string,
    private newPos: Position
  ) {
    this.oldPos = { x: 0, y: 0 };
  }

  async execute() {
    const node = await nodeRepo.getNode(this.nodeId);
    if (node) {
      this.oldPos = { ...node.position };
      await nodeRepo.updateNode(this.nodeId, { position: this.newPos });

      await eventlogRepo.addHistory({
        pageId: node.pageId,
        timestamp: new Date().toISOString(),
        action: 'move_node',
        payload: {
          nodeId: this.nodeId,
          position: this.newPos
        }
      });
    }
  }

  async undo() {
    const node = await nodeRepo.getNode(this.nodeId);
    if (node) {
      await nodeRepo.updateNode(this.nodeId, { position: this.oldPos });

      await eventlogRepo.addHistory({
        pageId: node.pageId,
        timestamp: new Date().toISOString(),
        action: 'move_node',
        payload: {
          nodeId: this.nodeId,
          position: this.oldPos
        }
      });
    }
  }
}

// 3. テキスト編集コマンド
export class UpdateNodeTextCommand implements Command {
  private oldText = '';

  constructor(
    private nodeId: string,
    private newText: string
  ) {}

  async execute() {
    const node = await nodeRepo.getNode(this.nodeId);
    if (node) {
      this.oldText = node.text;
      await nodeRepo.updateNode(this.nodeId, { text: this.newText });

      await eventlogRepo.addHistory({
        pageId: node.pageId,
        timestamp: new Date().toISOString(),
        action: 'update_node',
        payload: {
          nodeId: this.nodeId,
          text: this.newText
        }
      });
    }
  }

  async undo() {
    const node = await nodeRepo.getNode(this.nodeId);
    if (node) {
      await nodeRepo.updateNode(this.nodeId, { text: this.oldText });

      await eventlogRepo.addHistory({
        pageId: node.pageId,
        timestamp: new Date().toISOString(),
        action: 'update_node',
        payload: {
          nodeId: this.nodeId,
          text: this.oldText
        }
      });
    }
  }
}

// 4. ノード削除コマンド（配下子ノードも一括）
export class DeleteNodeCommand implements Command {
  private deletedNodes: MindMapNode[] = [];
  private deletedEdges: Edge[] = [];
  private deletedImages: Array<{ id: string; blob: Blob }> = [];
  private pageId = '';

  constructor(
    private targetNodeId: string
  ) {}

  async execute() {
    const node = await nodeRepo.getNode(this.targetNodeId);
    if (!node) return;
    
    this.pageId = node.pageId;

    const { deletedNodes, deletedEdges, deletedImages } = await nodeRepo.cascadeSoftDelete(this.targetNodeId);
    this.deletedNodes = deletedNodes;
    this.deletedEdges = deletedEdges;
    this.deletedImages = deletedImages;

    await eventlogRepo.addHistory({
      pageId: this.pageId,
      timestamp: new Date().toISOString(),
      action: 'delete_node',
      payload: {
        nodeId: this.targetNodeId,
        cascadeIds: this.deletedNodes.map((n) => n.id)
      }
    });
  }

  async undo() {
    await imageRepo.restoreImages(this.deletedImages);
    await nodeRepo.restoreNodes(this.deletedNodes);
    await edgeRepo.restoreEdges(this.deletedEdges);

    await eventlogRepo.addHistory({
      pageId: this.pageId,
      timestamp: new Date().toISOString(),
      action: 'create_node',
      payload: {
        nodes: this.deletedNodes,
        edges: this.deletedEdges
      }
    });
  }
}

// 5. 整列コマンド (Auto Layout)
export class AlignNodesCommand implements Command {
  private originalPositions = new Map<string, Position>();

  constructor(
    private pageId: string,
    private newPositions: Map<string, Position>
  ) {}

  async execute() {
    const allNodes = await nodeRepo.getNodesByPage(this.pageId);
    for (const node of allNodes) {
      this.originalPositions.set(node.id, { ...node.position });
    }

    await nodeRepo.updateNodePositions(Array.from(this.newPositions.entries()));

    await eventlogRepo.addHistory({
      pageId: this.pageId,
      timestamp: new Date().toISOString(),
      action: 'move_node',
      payload: {
        positions: Array.from(this.newPositions.entries())
      }
    });
  }

  async undo() {
    await nodeRepo.updateNodePositions(Array.from(this.originalPositions.entries()));

    await eventlogRepo.addHistory({
      pageId: this.pageId,
      timestamp: new Date().toISOString(),
      action: 'move_node',
      payload: {
        positions: Array.from(this.originalPositions.entries())
      }
    });
  }
}

// 6. ページタイトル変更コマンド
export class UpdatePageTitleCommand implements Command {
  private oldTitle = '';

  constructor(
    private pageId: string,
    private newTitle: string
  ) {}

  async execute() {
    const page = await pageRepo.getPage(this.pageId);
    if (page) {
      this.oldTitle = page.title;
      await pageRepo.updatePage(this.pageId, { title: this.newTitle });

      await eventlogRepo.addHistory({
        pageId: this.pageId,
        timestamp: new Date().toISOString(),
        action: 'update_page_title',
        payload: { title: this.newTitle }
      });
    }
  }

  async undo() {
    const page = await pageRepo.getPage(this.pageId);
    if (page) {
      await pageRepo.updatePage(this.pageId, { title: this.oldTitle });

      await eventlogRepo.addHistory({
        pageId: this.pageId,
        timestamp: new Date().toISOString(),
        action: 'update_page_title',
        payload: { title: this.oldTitle }
      });
    }
  }
}

// 7. ノード色更新コマンド
export class UpdateNodeColorCommand implements Command {
  private oldColor?: string;

  constructor(
    private nodeId: string,
    private newColor?: string
  ) {}

  async execute() {
    const node = await nodeRepo.getNode(this.nodeId);
    if (node) {
      this.oldColor = node.color;
      await nodeRepo.updateNode(this.nodeId, { color: this.newColor });

      await eventlogRepo.addHistory({
        pageId: node.pageId,
        timestamp: new Date().toISOString(),
        action: 'update_node',
        payload: {
          nodeId: this.nodeId,
          color: this.newColor
        }
      });
    }
  }

  async undo() {
    const node = await nodeRepo.getNode(this.nodeId);
    if (node) {
      await nodeRepo.updateNode(this.nodeId, { color: this.oldColor });

      await eventlogRepo.addHistory({
        pageId: node.pageId,
        timestamp: new Date().toISOString(),
        action: 'update_node',
        payload: {
          nodeId: this.nodeId,
          color: this.oldColor
        }
      });
    }
  }
}

