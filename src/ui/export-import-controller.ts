import { MindMapCanvas } from '../canvas';
import { store } from '../app/store';
import { getHistoryByPage } from '../data/eventlog-repo';
import { getImage } from '../data/image-repo';

export class ExportImportController {
  private exportDropdown: HTMLElement | null = null;
  private exportBtn: HTMLButtonElement | null = null;
  private exportMenu: HTMLElement | null = null;
  
  private exportPngBtn: HTMLElement | null = null;
  private exportMarkdownBtn: HTMLElement | null = null;
  private exportJsonBtn: HTMLElement | null = null;
  
  private importBtn: HTMLButtonElement | null = null;
  private importFileInput: HTMLInputElement | null = null;

  constructor(private canvasManager: MindMapCanvas) {
    this.exportDropdown = document.getElementById('export-dropdown');
    this.exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
    this.exportMenu = document.getElementById('export-menu');
    
    this.exportPngBtn = document.getElementById('export-png-btn');
    this.exportMarkdownBtn = document.getElementById('export-markdown-btn');
    this.exportJsonBtn = document.getElementById('export-json-btn');
    
    this.importBtn = document.getElementById('import-btn') as HTMLButtonElement;
    this.importFileInput = document.getElementById('import-file-input') as HTMLInputElement;
  }

  public initEvents() {
    // Dropdown toggling
    if (this.exportBtn && this.exportMenu) {
      this.exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pageId = store.getState().currentPageId;
        if (!pageId) return; // No page loaded
        this.exportMenu?.classList.toggle('hidden');
      });
    }

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (this.exportDropdown && !this.exportDropdown.contains(target)) {
        this.exportMenu?.classList.add('hidden');
      }
    });

    // PNG Export Click
    this.exportPngBtn?.addEventListener('click', () => {
      this.exportMenu?.classList.add('hidden');
      this.handleExportPNG();
    });

    // Markdown Export Click
    this.exportMarkdownBtn?.addEventListener('click', () => {
      this.exportMenu?.classList.add('hidden');
      this.handleExportMarkdown();
    });

    // JSON Export Click
    this.exportJsonBtn?.addEventListener('click', () => {
      this.exportMenu?.classList.add('hidden');
      this.handleExportJSON();
    });

    // Import Button Click (triggers hidden file input)
    this.importBtn?.addEventListener('click', () => {
      this.importFileInput?.click();
    });

    // File input change
    this.importFileInput?.addEventListener('change', () => {
      this.handleImportJSON();
    });

    // Disable export if no page is active
    store.subscribe((state) => {
      const hasPage = !!state.currentPageId;
      const isPast = state.playbackTime !== null;
      if (this.exportBtn) {
        this.exportBtn.disabled = !hasPage || isPast;
      }
      if (this.importBtn) {
        this.importBtn.disabled = isPast;
      }
    });
  }

  // --- PNG Export ---
  private handleExportPNG() {
    try {
      const state = store.getState();
      const pageId = state.currentPageId;
      if (!pageId) return;

      const page = state.pages.find((p) => p.pageId === pageId);
      const title = page ? page.title : 'notebook';

      const dataUrl = this.canvasManager.exportToPNG(true);
      
      const link = document.createElement('a');
      link.download = `${title}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('PNGエクスポート失敗:', err);
      alert('画像のエクスポートに失敗しました。');
    }
  }

  // --- Markdown Export ---
  private handleExportMarkdown() {
    try {
      const state = store.getState();
      const pageId = state.currentPageId;
      if (!pageId) return;

      const page = state.pages.find((p) => p.pageId === pageId);
      const title = page ? page.title : 'notebook';

      const markdown = this.generateMarkdownOutline(title, state.nodes, state.edges);
      
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.download = `${title}.md`;
      link.href = url;
      link.click();
      
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Markdownエクスポート失敗:', err);
      alert('Markdownのエクスポートに失敗しました。');
    }
  }

  // --- JSON Export ---
  private async handleExportJSON() {
    try {
      const state = store.getState();
      const pageId = state.currentPageId;
      if (!pageId) return;

      const page = state.pages.find((p) => p.pageId === pageId);
      if (!page) return;

      this.setButtonLoading(true);

      const nodes = state.nodes;
      const edges = state.edges;
      const histories = await getHistoryByPage(pageId);

      // Gather images
      const images: Array<{ id: string; data: string }> = [];
      for (const node of nodes) {
        if (node.media.hasImage && node.media.imageRef) {
          // We persistent store images under id: `img-${node.id}`
          const persistentImageId = `img-${node.id}`;
          const blob = await getImage(persistentImageId);
          if (blob) {
            const base64 = await this.blobToBase64(blob);
            images.push({ id: persistentImageId, data: base64 });
          }
        }
      }

      const exportData = {
        type: 'chronomap-page-export',
        version: '1.0',
        page,
        nodes,
        edges,
        histories,
        images
      };

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.download = `${page.title}.json`;
      link.href = url;
      link.click();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('JSONエクスポート失敗:', err);
      alert('JSONバックアップのエクスポートに失敗しました。');
    } finally {
      this.setButtonLoading(false);
    }
  }

  // --- JSON Import ---
  private async handleImportJSON() {
    const files = this.importFileInput?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target?.result as string;
          await store.importPage(content);
          alert('ノートのインポートに成功しました！');
        } catch (err: any) {
          console.error('JSONインポート失敗:', err);
          alert(`インポートに失敗しました: ${err.message || err}`);
        } finally {
          if (this.importFileInput) this.importFileInput.value = '';
        }
      };
      reader.readAsText(file);
    } catch (err: any) {
      console.error('ファイル読み込み失敗:', err);
      alert(`ファイルの読み込みに失敗しました: ${err.message || err}`);
      if (this.importFileInput) this.importFileInput.value = '';
    }
  }

  // --- Helper: Markdown generation ---
  private generateMarkdownOutline(pageTitle: string, nodes: any[], edges: any[]): string {
    const incoming = new Set(edges.map((e) => e.target));
    const roots = nodes.filter((n) => !incoming.has(n.id));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const childrenMap = new Map<string, string[]>();
    for (const edge of edges) {
      let list = childrenMap.get(edge.source);
      if (!list) {
        list = [];
        childrenMap.set(edge.source, list);
      }
      list.push(edge.target);
    }

    let result = `# ${pageTitle}\n\n`;

    const formattedNodes = new Set<string>();

    const formatNode = (nodeId: string, depth: number) => {
      const node = nodeMap.get(nodeId);
      if (!node || formattedNodes.has(nodeId)) return;

      formattedNodes.add(nodeId);
      const indent = '  '.repeat(depth);
      result += `${indent}- ${node.text}\n`;

      const children = childrenMap.get(nodeId) || [];
      for (const childId of children) {
        formatNode(childId, depth + 1);
      }
    };

    // Print roots
    for (const root of roots) {
      formatNode(root.id, 0);
    }

    // Fallback: If there are unformatted nodes, list them
    const unformatted = nodes.filter((n) => !formattedNodes.has(n.id));
    if (unformatted.length > 0) {
      result += '\n## その他のノード\n\n';
      for (const node of unformatted) {
        result += `- ${node.text}\n`;
      }
    }

    return result;
  }

  // --- Helper: Blob to Base64 ---
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private setButtonLoading(isLoading: boolean) {
    if (this.exportBtn) {
      if (isLoading) {
        this.exportBtn.classList.add('loading');
        this.exportBtn.style.opacity = '0.6';
      } else {
        this.exportBtn.classList.remove('loading');
        this.exportBtn.style.opacity = '';
      }
    }
  }
}
