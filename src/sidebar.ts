import { Page, MindMapNode } from './types';
import * as db from './db';
import { createIcons, Trash2, Copy } from 'lucide';

export class SidebarManager {
  // DOM要素
  private pageListEl: HTMLUListElement;
  private newPageBtn: HTMLButtonElement;
  private searchInput: HTMLInputElement;
  private sortSelect: HTMLSelectElement;

  // 状態
  private pages: Page[] = [];
  private currentPageId: string | null = null;
  private searchQuery = '';
  private sortKey = 'updatedAt_desc';

  // コールバック
  public onPageSelected: (pageId: string) => void;
  public onPageDeleted: (pageId: string) => void;
  public onPageCreated: (pageId: string) => void;

  constructor(
    onPageSelected: (pageId: string) => void,
    onPageDeleted: (pageId: string) => void,
    onPageCreated: (pageId: string) => void
  ) {
    this.onPageSelected = onPageSelected;
    this.onPageDeleted = onPageDeleted;
    this.onPageCreated = onPageCreated;

    // DOM 取得
    this.pageListEl = document.getElementById('page-list') as HTMLUListElement;
    this.newPageBtn = document.getElementById('new-page-btn') as HTMLButtonElement;
    this.searchInput = document.getElementById('search-input') as HTMLInputElement;
    this.sortSelect = document.getElementById('sort-select') as HTMLSelectElement;

    this.initEvents();
  }

  // 初期ロード
  public async loadPages(selectedPageId: string | null = null) {
    this.pages = await db.getAllPages();
    this.currentPageId = selectedPageId;
    await this.render();
  }

  // ページ一覧の描画
  private async render() {
    this.pageListEl.innerHTML = '';
    
    // ソートの適用
    const sortedPages = this.getSortedPages();

    // 検索の適用（フィルタリングと検索スニペットの準備）
    const searchFiltered = await this.filterPagesBySearch(sortedPages);

    if (searchFiltered.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'text-muted text-center py-4';
      emptyLi.style.fontSize = '0.85rem';
      emptyLi.style.listStyle = 'none';
      emptyLi.textContent = this.searchQuery ? '検索結果が見つかりません' : 'ノートがありません';
      this.pageListEl.appendChild(emptyLi);
      return;
    }

    for (const { page, snippet } of searchFiltered) {
      const isSelected = page.pageId === this.currentPageId;

      const li = document.createElement('li');
      li.className = `page-item glass-panel ${isSelected ? 'active' : ''}`;
      li.dataset.id = page.pageId;

      // 日時のフォーマット (YYYY/MM/DD)
      const dateStr = new Date(page.updatedAt).toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });

      // ノード数の取得
      const nodes = await db.getNodesByPage(page.pageId);
      const nodeCount = nodes.length;

      li.innerHTML = `
        <div class="page-item-title" title="${this.escapeHtml(page.title)}">${this.escapeHtml(page.title)}</div>
        ${snippet ? `<div class="page-item-snippet" style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">... ${this.escapeHtml(snippet)} ...</div>` : ''}
        <div class="page-item-meta" style="margin-top: 4px;">
          <span>${dateStr}</span>
          <span>${nodeCount} ノード</span>
        </div>
        
        <!-- コンテキストメニュー代わりの操作ボタン（マウスホバーで表示） -->
        <div class="page-item-actions" style="position: absolute; right: 8px; top: 8px; display: none; gap: 4px;">
          <button class="btn-action-clone" title="複製" style="background:transparent; border:none; color:var(--text-secondary); cursor:pointer;"><i data-lucide="copy" style="width:14px; height:14px;"></i></button>
          <button class="btn-action-delete" title="削除" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer;"><i data-lucide="trash-2" style="width:14px; height:14px;"></i></button>
        </div>
      `;

      // ホバーアクション用イベント
      li.addEventListener('mouseenter', () => {
        const actionsEl = li.querySelector('.page-item-actions') as HTMLElement;
        if (actionsEl) actionsEl.style.display = 'flex';
      });
      li.addEventListener('mouseleave', () => {
        const actionsEl = li.querySelector('.page-item-actions') as HTMLElement;
        if (actionsEl) actionsEl.style.display = 'none';
      });

      // アイテムクリックで選択
      li.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        // アクションボタンのクリック時はページ選択処理をスキップ
        if (target.closest('.btn-action-delete') || target.closest('.btn-action-clone')) {
          return;
        }
        
        this.selectPage(page.pageId);
      });

      // 複製ボタンイベント
      const cloneBtn = li.querySelector('.btn-action-clone') as HTMLButtonElement;
      cloneBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const cloned = await db.clonePage(page.pageId);
          await this.loadPages(cloned.pageId);
          this.onPageCreated(cloned.pageId);
        } catch (err) {
          console.error('Failed to clone page:', err);
        }
      });

      // 削除ボタンイベント
      const deleteBtn = li.querySelector('.btn-action-delete') as HTMLButtonElement;
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`ノート「${page.title}」を削除しますか？\n配下のエッジ、音声、写真データもすべて消去されます。`)) {
          try {
            await db.deletePage(page.pageId);
            this.onPageDeleted(page.pageId);
          } catch (err) {
            console.error('Failed to delete page:', err);
          }
        }
      });

      this.pageListEl.appendChild(li);
    }

    // Lucide アイコンをレンダリングされたDOMに再適用
    createIcons({
      icons: {
        Copy,
        Trash2
      }
    });
  }

  // ページ選択
  private selectPage(pageId: string) {
    if (this.currentPageId === pageId) return;
    this.currentPageId = pageId;
    
    // UIのactiveクラス更新
    const items = this.pageListEl.querySelectorAll('.page-item');
    items.forEach((item) => {
      const el = item as HTMLElement;
      if (el.dataset.id === pageId) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    this.onPageSelected(pageId);
  }

  // イベント初期化
  private initEvents() {
    // 新規作成ボタン
    this.newPageBtn.addEventListener('click', async () => {
      try {
        const newPage = await db.createPage('無題のノート');
        // 中心ルートノードを作成する
        await db.createNode({
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
        
        await this.loadPages(newPage.pageId);
        this.onPageCreated(newPage.pageId);
      } catch (err) {
        console.error('Failed to create page:', err);
      }
    });

    // 検索入力 (デバウンス処理付き)
    let searchTimeout: number;
    this.searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = window.setTimeout(() => {
        this.searchQuery = this.searchInput.value.trim().toLowerCase();
        this.render();
      }, 250);
    });

    // ソート切替
    this.sortSelect.addEventListener('change', () => {
      this.sortKey = this.sortSelect.value;
      this.render();
    });
  }

  // ソート処理
  private getSortedPages(): Page[] {
    const list = [...this.pages];
    switch (this.sortKey) {
      case 'createdAt_desc':
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case 'title_asc':
        return list.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
      case 'updatedAt_desc':
      default:
        return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
  }

  // 検索フィルタリング
  private async filterPagesBySearch(sortedList: Page[]): Promise<Array<{ page: Page; snippet: string }>> {
    if (!this.searchQuery) {
      return sortedList.map((page) => ({ page, snippet: '' }));
    }

    const filtered: Array<{ page: Page; snippet: string }> = [];

    for (const page of sortedList) {
      // 1. ページタイトルマッチ
      if (page.title.toLowerCase().includes(this.searchQuery)) {
        filtered.push({ page, snippet: '' });
        continue;
      }

      // 2. ページ内の全ノードテキストマッチ
      const nodes = await db.getNodesByPage(page.pageId);
      let matchedNode: MindMapNode | null = null;
      
      for (const node of nodes) {
        if (node.text.toLowerCase().includes(this.searchQuery)) {
          matchedNode = node;
          break;
        }
      }

      if (matchedNode) {
        // スニペットを生成 (前後15文字程度を切り出す)
        const text = matchedNode.text;
        const idx = text.toLowerCase().indexOf(this.searchQuery);
        const start = Math.max(0, idx - 10);
        const end = Math.min(text.length, idx + this.searchQuery.length + 10);
        const snippet = text.substring(start, end);
        
        filtered.push({ page, snippet });
      }
    }

    return filtered;
  }

  // HTMLエスケープ
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
