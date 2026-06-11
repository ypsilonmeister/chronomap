export interface ContextMenuCallbacks {
  onEditText: (nodeId: string) => void;
  onAudioInput: (nodeId: string) => void;
  onAttachImage: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
}

export class ContextMenuManager {
  private menuEl: HTMLElement;
  private currentNodeId: string | null = null;
  private callbacks: ContextMenuCallbacks | null = null;

  constructor() {
    this.menuEl = document.getElementById('node-context-menu') as HTMLElement;
    this.init();
  }

  private init() {
    // コンテキストメニュー以外の場所をクリックしたときに閉じる
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#node-context-menu')) {
        this.hide();
      }
    });

    // 各項目のクリックイベントバインド
    document.getElementById('menu-edit-text')?.addEventListener('click', () => {
      if (this.currentNodeId && this.callbacks) {
        this.callbacks.onEditText(this.currentNodeId);
      }
      this.hide();
    });

    document.getElementById('menu-audio-input')?.addEventListener('click', () => {
      if (this.currentNodeId && this.callbacks) {
        this.callbacks.onAudioInput(this.currentNodeId);
      }
      this.hide();
    });

    document.getElementById('menu-attach-image')?.addEventListener('click', () => {
      if (this.currentNodeId && this.callbacks) {
        this.callbacks.onAttachImage(this.currentNodeId);
      }
      this.hide();
    });

    document.getElementById('menu-delete-node')?.addEventListener('click', () => {
      if (this.currentNodeId && this.callbacks) {
        this.callbacks.onDeleteNode(this.currentNodeId);
      }
      this.hide();
    });
  }

  // メニューの表示
  public show(nodeId: string, x: number, y: number, callbacks: ContextMenuCallbacks) {
    this.currentNodeId = nodeId;
    this.callbacks = callbacks;

    // 表示位置を調整（画面外にはみ出さないように）
    const menuWidth = 180;
    const menuHeight = 160;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    let left = x;
    let top = y;

    if (x + menuWidth > windowWidth) {
      left = windowWidth - menuWidth - 10;
    }
    if (y + menuHeight > windowHeight) {
      top = windowHeight - menuHeight - 10;
    }

    this.menuEl.style.left = `${left}px`;
    this.menuEl.style.top = `${top}px`;
    this.menuEl.classList.remove('hidden');
  }

  // メニューの非表示
  public hide() {
    this.currentNodeId = null;
    this.menuEl.classList.add('hidden');
  }
}
