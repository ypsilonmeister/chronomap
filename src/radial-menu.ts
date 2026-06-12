export interface RadialMenuCallbacks {
  onEditText: (nodeId: string) => void;
  onAudioInput: (nodeId: string) => void;
  onAttachImage: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
}

interface RadialAction {
  action: string;
  angle: number; // degrees
  callback: ((nodeId: string) => void) | null;
}

export class RadialMenuManager {
  private menuEl: HTMLElement;
  private currentNodeId: string | null = null;
  private callbacks: RadialMenuCallbacks | null = null;
  private activeAction: string | null = null;
  private centerX = 0;
  private centerY = 0;
  private touchStartX = 0;
  private touchStartY = 0;
  private readonly RADIUS = 70;
  private readonly DEAD_ZONE = 20;

  private actions: RadialAction[] = [
    { action: 'audio',  angle: -90, callback: null },  // 上 (音声)
    { action: 'delete', angle: 0,   callback: null },  // 右 (削除)
    { action: 'image',  angle: 90,  callback: null },  // 下 (写真)
    { action: 'edit',   angle: 180, callback: null },  // 左 (編集)
  ];

  constructor() {
    this.menuEl = document.getElementById('radial-menu') as HTMLElement;
    this.init();
  }

  private init() {
    // メニュー外をクリックで閉じる
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#radial-menu')) {
        this.hide();
      }
    });

    // 各アイテムのクリックイベント（PC右クリック用）
    const items = this.menuEl.querySelectorAll('.radial-item');
    items.forEach((item) => {
      item.addEventListener('click', () => {
        const action = (item as HTMLElement).dataset.action;
        if (action && this.currentNodeId && this.callbacks) {
          this.executeAction(action);
        }
        this.hide();
      });
    });
  }

  private executeAction(action: string) {
    if (!this.currentNodeId || !this.callbacks) return;
    switch (action) {
      case 'edit':
        this.callbacks.onEditText(this.currentNodeId);
        break;
      case 'audio':
        this.callbacks.onAudioInput(this.currentNodeId);
        break;
      case 'image':
        this.callbacks.onAttachImage(this.currentNodeId);
        break;
      case 'delete':
        this.callbacks.onDeleteNode(this.currentNodeId);
        break;
    }
  }

  // メニュー表示
  public show(nodeId: string, x: number, y: number, callbacks: RadialMenuCallbacks) {
    this.currentNodeId = nodeId;
    this.callbacks = callbacks;
    this.activeAction = null;
    this.touchStartX = x;
    this.touchStartY = y;

    // 画面端に近い場合、中心をずらす
    const margin = this.RADIUS + 40;
    this.centerX = Math.max(margin, Math.min(window.innerWidth - margin, x));
    this.centerY = Math.max(margin, Math.min(window.innerHeight - margin, y));

    this.menuEl.style.left = `${this.centerX}px`;
    this.menuEl.style.top = `${this.centerY}px`;

    // ハイライトをクリア
    this.clearHighlight();

    this.menuEl.classList.remove('hidden');

    // 展開アニメーション用に少し遅らせてactiveクラスを付ける
    requestAnimationFrame(() => {
      this.menuEl.classList.add('open');
    });
  }

  // メニュー非表示
  public hide() {
    this.currentNodeId = null;
    this.activeAction = null;
    this.menuEl.classList.remove('open');
    this.clearHighlight();

    // アニメーション後にhiddenを付ける
    setTimeout(() => {
      if (!this.menuEl.classList.contains('open')) {
        this.menuEl.classList.add('hidden');
      }
    }, 200);
  }

  // タッチ移動時のハイライト更新
  public updateHighlight(clientX: number, clientY: number) {
    const dx = clientX - this.touchStartX;
    const dy = clientY - this.touchStartY;
    const distance = Math.hypot(dx, dy);

    this.clearHighlight();

    if (distance < this.DEAD_ZONE) {
      this.activeAction = null;
      return;
    }

    // タッチ方向の角度（度）を計算
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    // 最も近いアクションを探す
    let bestAction: RadialAction | null = null;
    let bestDiff = Infinity;

    for (const action of this.actions) {
      let diff = Math.abs(angle - action.angle);
      if (diff > 180) diff = 360 - diff;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestAction = action;
      }
    }

    if (bestAction) {
      this.activeAction = bestAction.action;
      const el = this.menuEl.querySelector(`.radial-item[data-action="${bestAction.action}"]`);
      if (el) el.classList.add('active');
    }
  }

  // 現在アクティブなアクションを実行
  public executeActiveAction(): boolean {
    if (this.activeAction && this.currentNodeId && this.callbacks) {
      this.executeAction(this.activeAction);
      this.hide();
      return true;
    }
    this.hide();
    return false;
  }

  // 表示中かどうか
  public isVisible(): boolean {
    return !this.menuEl.classList.contains('hidden');
  }

  private clearHighlight() {
    const items = this.menuEl.querySelectorAll('.radial-item');
    items.forEach((item) => item.classList.remove('active'));
    this.activeAction = null;
  }
}
