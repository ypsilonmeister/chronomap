export interface ShortcutCallbacks {
  onUndo: () => void;
  onRedo: () => void;
  onAddSibling: (nodeId: string) => void;
  onAddChild: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onEditText: (nodeId: string) => void;
  onAlign: () => void;
}

export class ShortcutManager {
  private callbacks: ShortcutCallbacks;
  private getSelectedNodeId: () => string | null;
  private isEditingText = false;

  constructor(
    getSelectedNodeId: () => string | null,
    callbacks: ShortcutCallbacks
  ) {
    this.getSelectedNodeId = getSelectedNodeId;
    this.callbacks = callbacks;
    this.init();
  }

  private init() {
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));
  }

  // 編集モード状態の切替
  public setEditingState(isEditing: boolean) {
    this.isEditingText = isEditing;
  }

  private handleKeyDown(e: KeyboardEvent) {
    // テキスト編集中の場合は、グローバルショートカットキーを無効化
    if (this.isEditingText) {
      return;
    }

    const selectedId = this.getSelectedNodeId();

    // Undo / Redo / Align (Ctrl + Z / Ctrl + Y / Ctrl + Shift + Z / Ctrl + Shift + L)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          this.callbacks.onRedo();
        } else {
          this.callbacks.onUndo();
        }
        return;
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.callbacks.onRedo();
        return;
      } else if (e.key.toLowerCase() === 'l' && e.shiftKey) {
        e.preventDefault();
        this.callbacks.onAlign();
        return;
      }
    }

    // ノードが選択されていない場合は、以下のキーショートカットは動作させない
    if (!selectedId) {
      return;
    }

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        this.callbacks.onAddSibling(selectedId);
        break;

      case 'Tab':
        e.preventDefault();
        this.callbacks.onAddChild(selectedId);
        break;

      case 'Delete':
      case 'Backspace':
        // インプット要素にフォーカスがある場合は削除しない
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
          return;
        }
        e.preventDefault();
        this.callbacks.onDeleteNode(selectedId);
        break;

      case 'F2':
        e.preventDefault();
        this.callbacks.onEditText(selectedId);
        break;

      default:
        break;
    }
  }
}
