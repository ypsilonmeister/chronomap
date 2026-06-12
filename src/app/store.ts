import { Page, MindMapNode, Edge } from '../types';
import * as pageRepo from '../data/page-repo';
import * as nodeRepo from '../data/node-repo';
import * as edgeRepo from '../data/edge-repo';
import { MediaManager } from '../media';

export type Listener<T> = (state: T) => void;

export interface AppState {
  pages: Page[];
  pageSummaries: Array<{ page: Page; nodeCount: number; nodeTexts: string[] }>;
  nodes: MindMapNode[];
  edges: Edge[];
  currentPageId: string | null;
  selectedNodeId: string | null;
  playbackTime: string | null;
  syncStatus: { status: 'idle' | 'syncing' | 'authenticated' | 'error' | 'offline'; msg?: string };
}

export class AppStore {
  private state: AppState = {
    pages: [],
    pageSummaries: [],
    nodes: [],
    edges: [],
    currentPageId: null,
    selectedNodeId: null,
    playbackTime: null,
    syncStatus: { status: 'idle' }
  };

  private listeners = new Set<Listener<AppState>>();

  public getState(): AppState {
    return this.state;
  }

  public subscribe(listener: Listener<AppState>): () => void {
    this.listeners.add(listener);
    // 即座に現在の状態を通知する
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  // 初期化処理
  public async initialize() {
    this.state.pages = await pageRepo.getAllPages();
    this.state.pageSummaries = await pageRepo.getPageSummaries();
    
    if (this.state.pages.length > 0) {
      this.state.currentPageId = this.state.pages[0].pageId;
    } else {
      // 初期ウェルカムページと中心ノードの作成
      const newPage = await pageRepo.createPage('ようこそノート');
      await nodeRepo.createNode({
        pageId: newPage.pageId,
        text: '中心テーマ',
        media: {
          hasImage: false,
          imageRef: '',
          hasAudio: false,
          audioRef: ''
        },
        position: { x: 0, y: 0 }
      });
      this.state.pages = await pageRepo.getAllPages();
      this.state.pageSummaries = await pageRepo.getPageSummaries();
      this.state.currentPageId = newPage.pageId;
    }
    this.state.selectedNodeId = null;
    this.state.playbackTime = null;
    await this.reloadPageData(this.state.currentPageId);
  }

  // ページデータの再読み込みと画像 Blob URL 解決
  public async reloadPageData(pageId: string) {
    const rawNodes = await nodeRepo.getNodesByPage(pageId);
    const edges = await edgeRepo.getEdgesByPage(pageId);

    // 画像の Local Blob URL を復元して適用
    const nodes: MindMapNode[] = [];
    for (const node of rawNodes) {
      const clonedNode = { ...node };
      if (node.media.hasImage && node.media.imageRef) {
        const blobUrl = await MediaManager.loadAndCreateImageURL(node.media.imageRef);
        if (blobUrl) {
          clonedNode.media = {
            ...node.media,
            imageRef: blobUrl
          };
        }
      }
      nodes.push(clonedNode);
    }

    this.state.nodes = nodes;
    this.state.edges = edges;
    
    // データが再読み込みされたらページサマリーも更新する (ノード数が変わるため)
    this.state.pageSummaries = await pageRepo.getPageSummaries();
    
    this.notify();
  }

  // ページ一覧のリロード
  public async reloadPages(selectedPageId: string | null = null) {
    this.state.pages = await pageRepo.getAllPages();
    this.state.pageSummaries = await pageRepo.getPageSummaries();
    if (selectedPageId) {
      this.state.currentPageId = selectedPageId;
    } else if (this.state.pages.length > 0) {
      if (!this.state.currentPageId || !this.state.pages.some(p => p.pageId === this.state.currentPageId)) {
        this.state.currentPageId = this.state.pages[0].pageId;
      }
    } else {
      this.state.currentPageId = null;
    }
    
    if (this.state.currentPageId) {
      await this.reloadPageData(this.state.currentPageId);
    } else {
      this.state.nodes = [];
      this.state.edges = [];
      this.state.selectedNodeId = null;
      this.notify();
    }
  }

  // ページ選択
  public async selectPage(pageId: string) {
    this.state.currentPageId = pageId;
    this.state.selectedNodeId = null;
    this.state.playbackTime = null;
    await this.reloadPageData(pageId);
  }

  // 新規ページ作成
  public async createPage(title: string): Promise<string> {
    const newPage = await pageRepo.createPage(title);
    await nodeRepo.createNode({
      pageId: newPage.pageId,
      text: '中心テーマ',
      media: {
        hasImage: false,
        imageRef: '',
        hasAudio: false,
        audioRef: ''
      },
      position: { x: 0, y: 0 }
    });
    await this.reloadPages(newPage.pageId);
    return newPage.pageId;
  }

  // ページ複製
  public async clonePage(pageId: string): Promise<string> {
    const cloned = await pageRepo.clonePage(pageId);
    await this.reloadPages(cloned.pageId);
    return cloned.pageId;
  }

  // ページ削除
  public async deletePage(pageId: string) {
    await pageRepo.deletePage(pageId);
    const wasActive = this.state.currentPageId === pageId;
    
    await this.reloadPages();
    
    if (wasActive && this.state.currentPageId) {
      await this.selectPage(this.state.currentPageId);
    }
  }

  // 選択ノードの更新
  public setSelectedNodeId(nodeId: string | null) {
    if (this.state.selectedNodeId !== nodeId) {
      this.state.selectedNodeId = nodeId;
      this.notify();
    }
  }

  // 再生タイムラインフィルターの更新
  public setPlaybackTime(time: string | null) {
    if (this.state.playbackTime !== time) {
      this.state.playbackTime = time;
      this.notify();
    }
  }

  // Google Drive 同期状態の更新
  public setSyncStatus(status: AppState['syncStatus']['status'], msg?: string) {
    this.state.syncStatus = { status, msg };
    this.notify();
  }
}

// シングルトンインスタンスのエクスポート
export const store = new AppStore();
