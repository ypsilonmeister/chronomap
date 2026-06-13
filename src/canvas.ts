import { MindMapNode, Edge, Position } from './types';
import { store } from './app/store';

export class MindMapCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // データ
  private nodes: MindMapNode[] = [];
  private edges: Edge[] = [];
  
  // 表示用フィルタデータ（タイムライン用）
  private filteredNodes: MindMapNode[] = [];
  private filteredEdges: Edge[] = [];

  // ビューポート状態
  private offsetX = 0;
  private offsetY = 0;
  private scale = 1;

  // 操作状態
  private selectedNodeId: string | null = null;
  private hoveredNodeId: string | null = null;
  private isHoveringPlusBtn = false;
  private draggedNodeId: string | null = null;
  private dragOffset: Position = { x: 0, y: 0 };
  
  private isPanning = false;
  private panStart: Position = { x: 0, y: 0 };

  // ピンチズーム用の状態
  private pinchStartDist = 0;
  private pinchStartScale = 1;
  private isPinching = false;

  // 描画関連
  private isDirty = true;
  private imageCache = new Map<string, HTMLImageElement>();
  private currentPlaybackTime: string | null = null;
  private longTapTimer: number | null = null;
  private isSwipeSelecting = false;
  private sizeCache = new Map<string, { width: number; height: number; text: string; hasImage: boolean; imageRef: string; imageComplete: boolean; isRoot: boolean }>();
  private edgeTargets = new Set<string>();
  private hoveredEdgeId: string | null = null;
  private isHoveringEdgeBtn = false;

  // 定数
  private readonly NODE_MAX_WIDTH = 180;
  private readonly NODE_PADDING_X = 16;
  private readonly NODE_PADDING_Y = 10;
  private readonly NODE_MIN_HEIGHT = 40;
  private readonly PLUS_BTN_RADIUS = 15;
  private readonly PLUS_BTN_OFFSET_X = 20; // ノード右端からのオフセット
  private readonly INSERT_BTN_RADIUS = 12;

  // コールバック
  public onNodeSelected: ((nodeId: string | null) => void) | null = null;
  public onNodeMoved: ((nodeId: string, pos: Position) => void) | null = null;
  public onAddChildNode: ((parentNodeId: string) => void) | null = null;
  public onAddRootNode: ((pos: Position) => void) | null = null;
  public onInsertNodeOnEdge: ((edgeId: string, pos: Position) => void) | null = null;
  public onContextMenu: ((nodeId: string, x: number, y: number) => void) | null = null;
  public onRadialSwipe: ((clientX: number, clientY: number) => void) | null = null;
  public onRadialRelease: (() => void) | null = null;
  public onZoomChanged: ((scale: number) => void) | null = null;
  public onRender: (() => void) | null = null;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context could not be initialized.');
    }
    this.ctx = context;

    this.initEvents();
    this.startRenderLoop();

    // AppStore の購読
    store.subscribe((state) => {
      const pageIdChanged = state.currentPageId !== (this.nodes[0]?.pageId || null);
      if (pageIdChanged) {
        this.sizeCache.clear();
      }
      this.nodes = state.nodes as MindMapNode[];
      this.edges = state.edges as Edge[];
      this.edgeTargets = new Set(this.edges.map(e => e.target));
      this.currentPlaybackTime = state.playbackTime;
      this.selectedNodeId = state.selectedNodeId;
      this.hoveredEdgeId = null;
      this.isHoveringEdgeBtn = false;
      this.applyTimeFilter();
      this.requestRender();
    });
  }



  // 現在のスケール取得
  public getScale(): number {
    return this.scale;
  }

  public getNodes(): readonly MindMapNode[] {
    return this.nodes;
  }

  public getEdges(): readonly Edge[] {
    return this.edges;
  }

  public getCanvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  public getOffsetX(): number {
    return this.offsetX;
  }

  public getOffsetY(): number {
    return this.offsetY;
  }

  public getCurrentPlaybackTime(): string | null {
    return this.currentPlaybackTime;
  }

  public isInPlaybackMode(): boolean {
    return this.currentPlaybackTime !== null;
  }

  public getNodeScreenBounds(nodeId: string): { left: number; top: number; width: number; height: number } | null {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return null;

    const size = this.calculateNodeSize(node);
    const rect = this.canvas.getBoundingClientRect();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;

    const screenX = (node.position.x * this.scale) + halfW + this.offsetX;
    const screenY = (node.position.y * this.scale) + halfH + this.offsetY;
    const screenW = size.width * this.scale;
    const screenH = size.height * this.scale;

    return {
      left: rect.left + screenX - screenW / 2,
      top: rect.top + screenY - screenH / 2,
      width: screenW,
      height: screenH
    };
  }

  public isPositionOnPlusButton(nodeId: string, worldPos: Position): boolean {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node || this.currentPlaybackTime) return false;

    const size = this.calculateNodeSize(node);
    const btnX = node.position.x + size.width / 2 + this.PLUS_BTN_OFFSET_X;
    const btnY = node.position.y;
    
    const dist = Math.hypot(worldPos.x - btnX, worldPos.y - btnY);
    return dist <= this.PLUS_BTN_RADIUS;
  }

  public isPositionOnNodeImage(nodeId: string, worldPos: Position): boolean {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node || !node.media.hasImage || !node.media.imageRef) return false;

    const size = this.calculateNodeSize(node);
    const rx = node.position.x - size.width / 2;
    const ry = node.position.y - size.height / 2;

    const img = this.imageCache.get(node.media.imageRef);
    if (img && img.complete) {
      const imgWidth = size.width - this.NODE_PADDING_X * 2;
      const imgHeight = (img.height / img.width) * imgWidth;

      const imgXMin = rx + this.NODE_PADDING_X;
      const imgXMax = rx + this.NODE_PADDING_X + imgWidth;
      const imgYMin = ry + this.NODE_PADDING_Y;
      const imgYMax = ry + this.NODE_PADDING_Y + imgHeight;

      return (
        worldPos.x >= imgXMin &&
        worldPos.x <= imgXMax &&
        worldPos.y >= imgYMin &&
        worldPos.y <= imgYMax
      );
    }
    return false;
  }

  // スケールリセット
  public resetZoom() {
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.requestRender();
    if (this.onZoomChanged) {
      this.onZoomChanged(this.scale);
    }
  }

  // 全画面フィット機能
  public fitToScreen() {
    const targetNodes = this.filteredNodes.length > 0 ? this.filteredNodes : this.nodes;
    if (targetNodes.length === 0) {
      this.resetZoom();
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const node of targetNodes) {
      const size = this.calculateNodeSize(node);
      const left = node.position.x - size.width / 2;
      const right = node.position.x + size.width / 2;
      const top = node.position.y - size.height / 2;
      const bottom = node.position.y + size.height / 2;

      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    }

    const w = maxX - minX;
    const h = maxY - minY;

    const rect = this.canvas.getBoundingClientRect();
    const canvasW = rect.width;
    const canvasH = rect.height;

    // パディングを設定 (上下左右に十分な余白を設定)
    const padding = 60;
    const availableW = Math.max(canvasW - padding * 2, 100);
    const availableH = Math.max(canvasH - padding * 2, 100);

    let targetScale = 1;
    if (w > 0 && h > 0) {
      targetScale = Math.min(availableW / w, availableH / h);
    }

    // スケール制限 (0.2 ~ 3.0)
    targetScale = Math.min(Math.max(targetScale, 0.2), 3.0);

    const centerX = minX + w / 2;
    const centerY = minY + h / 2;

    this.scale = targetScale;
    this.offsetX = -centerX * targetScale;
    this.offsetY = -centerY * targetScale;

    this.requestRender();
    if (this.onZoomChanged) {
      this.onZoomChanged(this.scale);
    }
  }

  /**
   * 現在のマインドマップ全体を画像データURL (PNG) としてエクスポートします。
   * @param forceFitToScreen エクスポート時に自動で全画面フィットさせるかどうか
   * @param backgroundColor 背景色。指定しない場合はテーマの背景色を取得します
   */
  public exportToPNG(forceFitToScreen = true, backgroundColor?: string): string {
    const originalScale = this.scale;
    const originalOffsetX = this.offsetX;
    const originalOffsetY = this.offsetY;

    if (forceFitToScreen) {
      this.fitToScreen();
    }

    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // 一時的な背景色の決定 (CSS変数 --bg-primary から取得、フォールバックは #0b0f19)
    const bg = backgroundColor || getComputedStyle(document.body).getPropertyValue('--bg-primary').trim() || '#0b0f19';

    // 背景を描画してクリア
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = bg;
    this.ctx.fillRect(0, 0, width, height);

    this.ctx.save();
    
    // ズーム & パンの適用
    this.ctx.translate(width / 2 + this.offsetX, height / 2 + this.offsetY);
    this.ctx.scale(this.scale, this.scale);

    // エッジ & ノードの描画
    this.drawEdges();
    this.drawNodes(width, height);

    this.ctx.restore();

    // 画像URLの取得
    const dataUrl = this.canvas.toDataURL('image/png');

    // 状態を復元
    this.scale = originalScale;
    this.offsetX = originalOffsetX;
    this.offsetY = originalOffsetY;
    this.requestRender();

    return dataUrl;
  }

  // 選択ノードの取得・設定
  public getSelectedNodeId(): string | null {
    return this.selectedNodeId;
  }

  public setSelectedNodeId(nodeId: string | null) {
    store.setSelectedNodeId(nodeId);
  }

  // ビューポートをリサイズ
  public resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.requestRender();
  }

  // 描画の要求
  public requestRender() {
    this.isDirty = true;
  }

  // タイムラインフィルタ適用
  private applyTimeFilter() {
    if (!this.currentPlaybackTime) {
      this.filteredNodes = [...this.nodes];
      this.filteredEdges = [...this.edges];
      return;
    }

    const T = new Date(this.currentPlaybackTime).getTime();

    // T時点以前に作成されたノードのみを抽出
    this.filteredNodes = this.nodes.filter(
      (node) => new Date(node.createdAt).getTime() <= T
    );

    // T時点以前に作成されたエッジのみを抽出
    this.filteredEdges = this.edges.filter(
      (edge) => new Date(edge.createdAt).getTime() <= T
    );
  }

  // レンダリングループの開始
  private startRenderLoop() {
    const loop = () => {
      if (this.isDirty) {
        this.render();
        this.isDirty = false;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // メイン描画処理
  private render() {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // キャンバスクリア
    this.ctx.clearRect(0, 0, width, height);

    this.ctx.save();
    
    // ズーム & パンの適用
    this.ctx.translate(width / 2 + this.offsetX, height / 2 + this.offsetY);
    this.ctx.scale(this.scale, this.scale);

    // エッジ (線) の描画
    this.drawEdges();

    // エッジ挿入ボタンの描画（ホバーされている場合）
    this.drawEdgeInsertButton();

    // ノードの描画
    this.drawNodes(width, height);

    this.ctx.restore();

    if (this.onRender) {
      this.onRender();
    }
  }

  // エッジの接続候補点と中間点（t = 0.5）を取得するヘルパー
  private getEdgePoints(edge: Edge): {
    sx: number; sy: number; tx: number; ty: number;
    cp1x: number; cp1y: number; cp2x: number; cp2y: number;
    midX: number; midY: number;
  } | null {
    const sourceNode = this.nodes.find((n) => n.id === edge.source && !n.deleted);
    const targetNode = this.nodes.find((n) => n.id === edge.target && !n.deleted);
    if (!sourceNode || !targetNode) return null;

    const sourceSize = this.calculateNodeSize(sourceNode);
    const targetSize = this.calculateNodeSize(targetNode);

    const sx = sourceNode.position.x;
    const sy = sourceNode.position.y;
    const tx = targetNode.position.x;
    const ty = targetNode.position.y;

    const sPoints = [
      { x: sx - sourceSize.width / 2, y: sy, direction: 'left' },
      { x: sx + sourceSize.width / 2, y: sy, direction: 'right' },
      { x: sx, y: sy - sourceSize.height / 2, direction: 'top' },
      { x: sx, y: sy + sourceSize.height / 2, direction: 'bottom' }
    ];

    const tPoints = [
      { x: tx - targetSize.width / 2, y: ty, direction: 'left' },
      { x: tx + targetSize.width / 2, y: ty, direction: 'right' },
      { x: tx, y: ty - targetSize.height / 2, direction: 'top' },
      { x: tx, y: ty + targetSize.height / 2, direction: 'bottom' }
    ];

    let bestSPt = sPoints[0];
    let bestTPt = tPoints[0];
    let minDistance = Infinity;

    for (const sPt of sPoints) {
      for (const tPt of tPoints) {
        const dist = Math.hypot(sPt.x - tPt.x, sPt.y - tPt.y);
        if (dist < minDistance) {
          minDistance = dist;
          bestSPt = sPt;
          bestTPt = tPt;
        }
      }
    }

    let cp1x = bestSPt.x;
    let cp1y = bestSPt.y;
    if (bestSPt.direction === 'left') cp1x -= 60;
    else if (bestSPt.direction === 'right') cp1x += 60;
    else if (bestSPt.direction === 'top') cp1y -= 60;
    else if (bestSPt.direction === 'bottom') cp1y += 60;

    let cp2x = bestTPt.x;
    let cp2y = bestTPt.y;
    if (bestTPt.direction === 'left') cp2x -= 60;
    else if (bestTPt.direction === 'right') cp2x += 60;
    else if (bestTPt.direction === 'top') cp2y -= 60;
    else if (bestTPt.direction === 'bottom') cp2y += 60;

    // 3次ベジェ曲線の中間点 (t = 0.5) を計算
    const t = 0.5;
    const mt = 1 - t;
    const w0 = mt * mt * mt;      // 0.125
    const w1 = 3 * mt * mt * t;  // 0.375
    const w2 = 3 * mt * t * t;    // 0.375
    const w3 = t * t * t;        // 0.125

    const midX = w0 * bestSPt.x + w1 * cp1x + w2 * cp2x + w3 * bestTPt.x;
    const midY = w0 * bestSPt.y + w1 * cp1y + w2 * cp2y + w3 * bestTPt.y;

    return {
      sx: bestSPt.x,
      sy: bestSPt.y,
      tx: bestTPt.x,
      ty: bestTPt.y,
      cp1x,
      cp1y,
      cp2x,
      cp2y,
      midX,
      midY
    };
  }

  // エッジの描画
  private drawEdges() {
    this.ctx.save();
    this.ctx.lineWidth = 2.5;

    const nodeMap = new Map<string, MindMapNode>();
    for (const n of this.filteredNodes) {
      nodeMap.set(n.id, n);
    }

    for (const edge of this.filteredEdges) {
      const pts = this.getEdgePoints(edge);
      if (!pts) continue;

      const sourceNode = nodeMap.get(edge.source);
      if (!sourceNode) continue;

      this.ctx.beginPath();
      this.ctx.moveTo(pts.sx, pts.sy);
      this.ctx.bezierCurveTo(pts.cp1x, pts.cp1y, pts.cp2x, pts.cp2y, pts.tx, pts.ty);

      // グラデーションエッジ
      const grad = this.ctx.createLinearGradient(pts.sx, pts.sy, pts.tx, pts.ty);
      const isParentRoot = !this.edgeTargets.has(sourceNode.id);

      if (isParentRoot) {
        grad.addColorStop(0, '#6366f1'); // インディゴ
        grad.addColorStop(1, '#a855f7'); // パープル
      } else {
        grad.addColorStop(0, 'rgba(168, 85, 247, 0.6)');
        grad.addColorStop(1, 'rgba(236, 72, 153, 0.6)');
      }

      this.ctx.strokeStyle = grad;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  // エッジ追加ボタンの描画
  private drawEdgeInsertButton() {
    if (!this.hoveredEdgeId || this.currentPlaybackTime) return;

    const edge = this.edges.find((e) => e.id === this.hoveredEdgeId);
    if (!edge) return;

    const pts = this.getEdgePoints(edge);
    if (!pts) return;

    const x = pts.midX;
    const y = pts.midY;
    const isHovered = this.isHoveringEdgeBtn;

    this.ctx.save();

    // ぼかしシャドウ
    this.ctx.shadowColor = isHovered ? 'rgba(99, 102, 241, 0.6)' : 'rgba(0, 0, 0, 0.3)';
    this.ctx.shadowBlur = isHovered ? 12 : 6;
    this.ctx.shadowOffsetY = 2;

    // ボタンの円
    this.ctx.beginPath();
    this.ctx.arc(x, y, this.INSERT_BTN_RADIUS, 0, Math.PI * 2);

    // グラデーションの作成
    const grad = this.ctx.createLinearGradient(x - this.INSERT_BTN_RADIUS, y - this.INSERT_BTN_RADIUS, x + this.INSERT_BTN_RADIUS, y + this.INSERT_BTN_RADIUS);
    if (isHovered) {
      grad.addColorStop(0, '#818cf8'); // 明るいインディゴ
      grad.addColorStop(1, '#c084fc'); // 明るいパープル
    } else {
      grad.addColorStop(0, '#6366f1'); // インディゴ
      grad.addColorStop(1, '#a855f7'); // パープル
    }
    this.ctx.fillStyle = grad;
    this.ctx.fill();

    // 白ボーダー
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetY = 0;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    // 十字架 (+)
    const size = 5;
    this.ctx.beginPath();
    this.ctx.moveTo(x - size, y);
    this.ctx.lineTo(x + size, y);
    this.ctx.moveTo(x, y - size);
    this.ctx.lineTo(x, y + size);
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.restore();
  }

  // ノードの描画
  private drawNodes(canvasWidth: number, canvasHeight: number) {
    const halfW = canvasWidth / 2;
    const halfH = canvasHeight / 2;

    for (const node of this.filteredNodes) {
      const size = this.calculateNodeSize(node);
      const rx = node.position.x - size.width / 2;
      const ry = node.position.y - size.height / 2;

      // --- Culling (画面外描画スキップ) ---
      // ワールド座標からスクリーン座標への変換
      const screenX = (node.position.x * this.scale) + halfW + this.offsetX;
      const screenY = (node.position.y * this.scale) + halfH + this.offsetY;
      const screenW = size.width * this.scale;
      const screenH = size.height * this.scale;

      if (
        screenX + screenW / 2 + 100 < 0 || 
        screenX - screenW / 2 - 100 > canvasWidth ||
        screenY + screenH / 2 + 100 < 0 || 
        screenY - screenH / 2 - 100 > canvasHeight
      ) {
        continue; // 画面外なら描画しない
      }

      const isSelected = node.id === this.selectedNodeId;
      const isHovered = node.id === this.hoveredNodeId;
      const isRoot = !this.edgeTargets.has(node.id);

      this.ctx.save();
      // Node Color variables
      const nodeColor = node.color || 'default';

      // 1. シャドウ (選択中またはホバー中は強めに、ノードカラーに応じた発光色を適用)
      let shadowCol = 'rgba(0, 0, 0, 0.4)';
      if (isSelected) {
        if (nodeColor === 'blue') shadowCol = 'rgba(59, 130, 246, 0.4)';
        else if (nodeColor === 'green') shadowCol = 'rgba(16, 185, 129, 0.4)';
        else if (nodeColor === 'orange') shadowCol = 'rgba(249, 115, 22, 0.4)';
        else if (nodeColor === 'pink') shadowCol = 'rgba(236, 72, 153, 0.4)';
        else if (nodeColor === 'purple') shadowCol = 'rgba(168, 85, 247, 0.4)';
        else if (nodeColor === 'red') shadowCol = 'rgba(239, 68, 68, 0.4)';
        else shadowCol = 'rgba(99, 102, 241, 0.4)';
      }
      this.ctx.shadowColor = shadowCol;
      this.ctx.shadowBlur = isSelected ? 15 : isHovered ? 10 : 6;
      this.ctx.shadowOffsetY = 4;

      // 2. ノードの背景 (角丸矩形)
      this.ctx.beginPath();
      this.ctx.roundRect?.(rx, ry, size.width, size.height, 10);
      
      if (isRoot) {
        // ルートノードはグラデーション背景
        const grad = this.ctx.createLinearGradient(rx, ry, rx + size.width, ry + size.height);
        if (nodeColor === 'blue') {
          grad.addColorStop(0, '#2563eb');
          grad.addColorStop(1, '#3b82f6');
        } else if (nodeColor === 'green') {
          grad.addColorStop(0, '#059669');
          grad.addColorStop(1, '#10b981');
        } else if (nodeColor === 'orange') {
          grad.addColorStop(0, '#ea580c');
          grad.addColorStop(1, '#f97316');
        } else if (nodeColor === 'pink') {
          grad.addColorStop(0, '#db2777');
          grad.addColorStop(1, '#ec4899');
        } else if (nodeColor === 'purple') {
          grad.addColorStop(0, '#7c3aed');
          grad.addColorStop(1, '#a855f7');
        } else if (nodeColor === 'red') {
          grad.addColorStop(0, '#dc2626');
          grad.addColorStop(1, '#ef4444');
        } else {
          grad.addColorStop(0, '#6366f1');
          grad.addColorStop(1, '#a855f7');
        }
        this.ctx.fillStyle = grad;
        this.ctx.fill();
      } else {
        // 子ノードはグラスモルフィズム風の半透明背景 + 選択色のオーバーレイ
        let baseBg = isHovered ? 'rgba(30, 41, 59, 0.95)' : 'rgba(15, 23, 42, 0.85)';
        this.ctx.fillStyle = baseBg;
        this.ctx.fill();

        if (nodeColor !== 'default') {
          this.ctx.save();
          this.ctx.beginPath();
          this.ctx.roundRect?.(rx, ry, size.width, size.height, 10);
          
          let tint = 'rgba(0, 0, 0, 0)';
          if (nodeColor === 'blue') tint = isHovered ? 'rgba(59, 130, 246, 0.18)' : 'rgba(59, 130, 246, 0.1)';
          else if (nodeColor === 'green') tint = isHovered ? 'rgba(16, 185, 129, 0.18)' : 'rgba(16, 185, 129, 0.1)';
          else if (nodeColor === 'orange') tint = isHovered ? 'rgba(249, 115, 22, 0.18)' : 'rgba(249, 115, 22, 0.1)';
          else if (nodeColor === 'pink') tint = isHovered ? 'rgba(236, 72, 153, 0.18)' : 'rgba(236, 72, 153, 0.1)';
          else if (nodeColor === 'purple') tint = isHovered ? 'rgba(168, 85, 247, 0.18)' : 'rgba(168, 85, 247, 0.1)';
          else if (nodeColor === 'red') tint = isHovered ? 'rgba(239, 68, 68, 0.18)' : 'rgba(239, 68, 68, 0.1)';
          
          this.ctx.fillStyle = tint;
          this.ctx.fill();
          this.ctx.restore();
        }
      }

      // 3. ボーダー
      this.ctx.shadowBlur = 0;
      this.ctx.shadowOffsetY = 0;

      let borderStyle = isRoot ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.08)';
      if (!isRoot && nodeColor !== 'default') {
        if (nodeColor === 'blue') borderStyle = 'rgba(59, 130, 246, 0.5)';
        else if (nodeColor === 'green') borderStyle = 'rgba(16, 185, 129, 0.5)';
        else if (nodeColor === 'orange') borderStyle = 'rgba(249, 115, 22, 0.5)';
        else if (nodeColor === 'pink') borderStyle = 'rgba(236, 72, 153, 0.5)';
        else if (nodeColor === 'purple') borderStyle = 'rgba(168, 85, 247, 0.5)';
        else if (nodeColor === 'red') borderStyle = 'rgba(239, 68, 68, 0.5)';
      }

      if (isSelected) {
        if (nodeColor === 'blue') this.ctx.strokeStyle = '#60a5fa';
        else if (nodeColor === 'green') this.ctx.strokeStyle = '#34d399';
        else if (nodeColor === 'orange') this.ctx.strokeStyle = '#fb923c';
        else if (nodeColor === 'pink') this.ctx.strokeStyle = '#f472b6';
        else if (nodeColor === 'purple') this.ctx.strokeStyle = '#c084fc';
        else if (nodeColor === 'red') this.ctx.strokeStyle = '#f87171';
        else this.ctx.strokeStyle = '#818cf8';
        this.ctx.lineWidth = 2.5;
      } else {
        this.ctx.strokeStyle = borderStyle;
        this.ctx.lineWidth = 1;
      }
      this.ctx.stroke();

      // 4. 画像添付の描画
      let currentY = ry + this.NODE_PADDING_Y;
      if (node.media.hasImage && node.media.imageRef) {
        const img = this.getOrLoadImage(node.media.imageRef);
        if (img && img.complete) {
          const imgWidth = size.width - this.NODE_PADDING_X * 2;
          // アスペクト比に合わせて高さを計算
          const imgHeight = (img.height / img.width) * imgWidth;
          this.ctx.drawImage(img, rx + this.NODE_PADDING_X, currentY, imgWidth, imgHeight);
          currentY += imgHeight + 8;
        } else {
          // ロード中のプレースホルダー
          const imgWidth = size.width - this.NODE_PADDING_X * 2;
          const imgHeight = 60;
          this.ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
          this.ctx.beginPath();
          this.ctx.roundRect?.(rx + this.NODE_PADDING_X, currentY, imgWidth, imgHeight, 6);
          this.ctx.fill();
          this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
          this.ctx.stroke();
          
          this.ctx.fillStyle = '#64748b';
          this.ctx.font = '10px "Inter"';
          this.ctx.textAlign = 'center';
          this.ctx.fillText('Loading image...', node.position.x, currentY + imgHeight / 2);
          currentY += imgHeight + 8;
        }
      }

      // 5. テキスト描画 (自動折り返し対応)
      this.ctx.fillStyle = '#f8fafc';
      this.ctx.font = isRoot ? '600 14px "Inter", "Noto Sans JP", sans-serif' : '400 13px "Inter", "Noto Sans JP", sans-serif';
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'top';

      const lines = this.wrapText(node.text, this.NODE_MAX_WIDTH);
      const lineHeight = isRoot ? 18 : 16;
      
      for (const line of lines) {
        this.ctx.fillText(line, rx + this.NODE_PADDING_X, currentY);
        currentY += lineHeight;
      }

      // 5.5. 時間情報の描画 (目立たないように小さく右寄せ)
      currentY += 4;
      this.ctx.fillStyle = isRoot ? 'rgba(255, 255, 255, 0.5)' : '#64748b';
      this.ctx.font = '500 9px "Inter", "Noto Sans JP", sans-serif';
      this.ctx.textAlign = 'right';
      this.ctx.textBaseline = 'top';
      const date = new Date(node.createdAt);
      const h = date.getHours().toString().padStart(2, '0');
      const m = date.getMinutes().toString().padStart(2, '0');
      const s = date.getSeconds().toString().padStart(2, '0');
      const timeStr = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${h}:${m}:${s}`;
      this.ctx.fillText(timeStr, rx + size.width - this.NODE_PADDING_X, currentY);
      currentY += 12;

      // 6. ホバー時に「＋」派生ボタンを描画
      if (isHovered && !this.currentPlaybackTime) {
        this.drawPlusButton(rx + size.width, node.position.y);
      }

      this.ctx.restore();
    }
  }

  // ＋ボタンの描画
  private drawPlusButton(x: number, y: number) {
    const btnX = x + this.PLUS_BTN_OFFSET_X;
    const isBtnHovered = this.isHoveringPlusBtn;

    this.ctx.save();
    
    // シャドウ
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    this.ctx.shadowBlur = 6;
    this.ctx.shadowOffsetY = 2;

    // 円形背景
    this.ctx.beginPath();
    this.ctx.arc(btnX, y, this.PLUS_BTN_RADIUS, 0, Math.PI * 2);
    this.ctx.fillStyle = isBtnHovered ? '#818cf8' : '#6366f1';
    this.ctx.fill();
    
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetY = 0;
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1;
    this.ctx.stroke();

    // ＋の十字線
    const crossHalfSize = Math.round(this.PLUS_BTN_RADIUS * 0.5);
    this.ctx.beginPath();
    this.ctx.moveTo(btnX - crossHalfSize, y);
    this.ctx.lineTo(btnX + crossHalfSize, y);
    this.ctx.moveTo(btnX, y - crossHalfSize);
    this.ctx.lineTo(btnX, y + crossHalfSize);
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();

    this.ctx.restore();
  }

  // テキストの折り返し計算
  private wrapText(text: string, maxWidth: number): string[] {
    const words = Array.from(text); // 日本語一文字ずつ対応
    const lines: string[] = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const char = words[i];
      // 改行コード対応
      if (char === '\n') {
        lines.push(currentLine);
        currentLine = '';
        continue;
      }

      const testLine = currentLine + char;
      const metrics = this.ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && i > 0) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine);
    return lines.filter((l) => l.length > 0);
  }

  // ノードの動的なサイズ計算
  public calculateNodeSize(node: MindMapNode): { width: number; height: number } {
    const isRoot = !this.edgeTargets.has(node.id);
    const img = node.media.hasImage && node.media.imageRef ? this.imageCache.get(node.media.imageRef) : null;
    const imgComplete = !!(img && img.complete);

    const cached = this.sizeCache.get(node.id);
    if (
      cached &&
      cached.text === node.text &&
      cached.hasImage === node.media.hasImage &&
      cached.imageRef === node.media.imageRef &&
      cached.imageComplete === imgComplete &&
      cached.isRoot === isRoot
    ) {
      return { width: cached.width, height: cached.height };
    }

    this.ctx.save();
    this.ctx.font = isRoot ? '600 14px "Inter", "Noto Sans JP", sans-serif' : '400 13px "Inter", "Noto Sans JP", sans-serif';

    const lines = this.wrapText(node.text, this.NODE_MAX_WIDTH);
    const lineHeight = isRoot ? 18 : 16;
    let height = this.NODE_PADDING_Y * 2 + lines.length * lineHeight + 16; // 16px added for time metadata (4px spacing + 12px font height)
    let maxWidth = 0;

    for (const line of lines) {
      const width = this.ctx.measureText(line).width;
      if (width > maxWidth) {
        maxWidth = width;
      }
    }

    let nodeWidth = Math.max(maxWidth + this.NODE_PADDING_X * 2, 110); // Minimum width increased to 110 to fit time string
    nodeWidth = Math.min(nodeWidth, this.NODE_MAX_WIDTH + this.NODE_PADDING_X * 2);

    // 画像アタッチ時のサイズ加算
    if (node.media.hasImage && node.media.imageRef) {
      if (img && img.complete) {
        const imgWidth = nodeWidth - this.NODE_PADDING_X * 2;
        const imgHeight = (img.height / img.width) * imgWidth;
        height += imgHeight + 8;
      } else {
        height += 60 + 8; // 画像ローディングプレースホルダーの高さ
      }
    }

    this.ctx.restore();

    const size = { 
      width: nodeWidth, 
      height: Math.max(height, this.NODE_MIN_HEIGHT) 
    };

    this.sizeCache.set(node.id, {
      width: size.width,
      height: size.height,
      text: node.text,
      hasImage: node.media.hasImage,
      imageRef: node.media.imageRef,
      imageComplete: imgComplete,
      isRoot
    });

    return size;
  }

  // 画像キャッシュと動的ロード
  private getOrLoadImage(ref: string): HTMLImageElement | null {
    if (this.imageCache.has(ref)) {
      return this.imageCache.get(ref) || null;
    }

    // Local Blob URL または IndexedDB から取得してキャッシュする
    const img = new Image();
    img.src = ref;
    img.onload = () => {
      this.requestRender();
    };
    img.onerror = () => {
      console.error(`Failed to load image: ${ref}`);
    };
    this.imageCache.set(ref, img);
    return img;
  }

  // 画像キャッシュクリア
  public clearImageCache(ref?: string) {
    if (ref) {
      this.imageCache.delete(ref);
    } else {
      this.imageCache.clear();
    }
    this.requestRender();
  }

  // スクリーン座標 -> ワールド座標への逆変換
  public screenToWorld(x: number, y: number): Position {
    const rect = this.canvas.getBoundingClientRect();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;

    return {
      x: (x - halfW - this.offsetX) / this.scale,
      y: (y - halfH - this.offsetY) / this.scale,
    };
  }

  // イベントリスナーの初期化
  private initEvents() {
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.handleMouseUp());
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', (e) => this.handleDblClick(e));
    this.canvas.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
    
    // タッチ対応 (passive: false でピンチズーム時のデフォルトスクロールを防止)
    this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));
  }

  // ==========================================
  // マウスイベントハンドラ
  // ==========================================

  private handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldPos = this.screenToWorld(mouseX, mouseY);

    // 左クリック
    if (e.button === 0) {
      const activeEl = document.activeElement;
      const isEditing = activeEl && activeEl.classList.contains('canvas-textarea');

      // 1. ノード上クリック判定
      const hitNode = this.findNodeAt(worldPos);
      if (hitNode) {
        if (isEditing && hitNode.id !== this.selectedNodeId) {
          (activeEl as HTMLElement).blur();
        }

        // ＋ボタン上のクリックか判定
        if (hitNode.id === this.hoveredNodeId && this.isHoveringPlusBtn && !this.currentPlaybackTime) {
          if (this.onAddChildNode) {
            this.onAddChildNode(hitNode.id);
          }
          return;
        }

        // ノード選択とドラッグ開始
        this.setSelectedNodeId(hitNode.id);
        this.draggedNodeId = hitNode.id;
        this.dragOffset = {
          x: worldPos.x - hitNode.position.x,
          y: worldPos.y - hitNode.position.y,
        };
        this.canvas.style.cursor = 'grabbing';
      } else {
        if (isEditing) {
          (activeEl as HTMLElement).blur();
        }

        // 2. エッジ挿入ボタン上クリック判定
        if (this.hoveredEdgeId && this.isHoveringEdgeBtn && !this.currentPlaybackTime) {
          if (this.onInsertNodeOnEdge) {
            const edge = this.edges.find((e) => e.id === this.hoveredEdgeId);
            if (edge) {
              const pts = this.getEdgePoints(edge);
              if (pts) {
                this.onInsertNodeOnEdge(this.hoveredEdgeId, { x: pts.midX, y: pts.midY });
                return;
              }
            }
          }
        }

        // 空白地クリックはパン開始
        this.isPanning = true;
        this.panStart = { x: mouseX - this.offsetX, y: mouseY - this.offsetY };
        this.canvas.style.cursor = 'grabbing';
        this.setSelectedNodeId(null);
      }
    }
  }

  private handleMouseMove(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 1. パン操作中
    if (this.isPanning) {
      this.offsetX = mouseX - this.panStart.x;
      this.offsetY = mouseY - this.panStart.y;
      this.requestRender();
      return;
    }

    // 2. ノードドラッグ操作中
    const worldPos = this.screenToWorld(mouseX, mouseY);
    if (this.draggedNodeId && !this.currentPlaybackTime) {
      const node = this.nodes.find((n) => n.id === this.draggedNodeId);
      if (node) {
        node.position = {
          x: worldPos.x - this.dragOffset.x,
          y: worldPos.y - this.dragOffset.y,
        };
        this.requestRender();
      }
      return;
    }

    // 3. 通常ホバー判定 (プラスボタン or ノード自体)
    const hitNode = this.findNodeAt(worldPos);
    if (hitNode) {
      this.hoveredNodeId = hitNode.id;
      
      // プラスボタンの上にホバーしているか
      if (hitNode.id === this.hoveredNodeId && !this.currentPlaybackTime) {
        const size = this.calculateNodeSize(hitNode);
        const btnX = hitNode.position.x + size.width / 2 + this.PLUS_BTN_OFFSET_X;
        const btnY = hitNode.position.y;
        
        const dist = Math.hypot(worldPos.x - btnX, worldPos.y - btnY);
        this.isHoveringPlusBtn = dist <= this.PLUS_BTN_RADIUS;
      } else {
        this.isHoveringPlusBtn = false;
      }
      
      this.hoveredEdgeId = null;
      this.isHoveringEdgeBtn = false;
      
      this.canvas.style.cursor = this.isHoveringPlusBtn ? 'pointer' : 'grab';
      this.requestRender();
    } else {
      if (this.hoveredNodeId !== null) {
        this.hoveredNodeId = null;
        this.isHoveringPlusBtn = false;
      }

      // エッジのホバー判定
      if (!this.currentPlaybackTime) {
        let bestEdgeId: string | null = null;
        let bestDist = Infinity;

        for (const edge of this.filteredEdges) {
          const pts = this.getEdgePoints(edge);
          if (!pts) continue;

          const dist = Math.hypot(worldPos.x - pts.midX, worldPos.y - pts.midY);
          if (dist < bestDist) {
            bestDist = dist;
            bestEdgeId = edge.id;
          }
        }

        if (bestDist <= 24) {
          this.hoveredEdgeId = bestEdgeId;
          this.isHoveringEdgeBtn = bestDist <= this.INSERT_BTN_RADIUS;
          this.canvas.style.cursor = this.isHoveringEdgeBtn ? 'pointer' : 'grab';
        } else {
          this.hoveredEdgeId = null;
          this.isHoveringEdgeBtn = false;
          this.canvas.style.cursor = 'grab';
        }
      } else {
        this.hoveredEdgeId = null;
        this.isHoveringEdgeBtn = false;
        this.canvas.style.cursor = 'grab';
      }
      
      this.requestRender();
    }
  }

  private handleMouseUp() {
    // ノードのドラッグ完了
    if (this.draggedNodeId) {
      const node = this.nodes.find((n) => n.id === this.draggedNodeId);
      if (node && this.onNodeMoved) {
        this.onNodeMoved(node.id, { ...node.position });
      }
      this.draggedNodeId = null;
    }

    this.isPanning = false;
    this.canvas.style.cursor = this.hoveredNodeId ? (this.isHoveringPlusBtn ? 'pointer' : 'grab') : (this.hoveredEdgeId && this.isHoveringEdgeBtn ? 'pointer' : 'grab');
  }

  // ホイールズーム
  private handleWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomIntensity = 0.1;
    const worldPos = this.screenToWorld(mouseX, mouseY);

    const oldScale = this.scale;
    if (e.deltaY < 0) {
      this.scale = Math.min(this.scale * (1 + zoomIntensity), 3.0); // 最大3倍
    } else {
      this.scale = Math.max(this.scale * (1 - zoomIntensity), 0.2); // 最小0.2倍
    }

    // ズーム中心をカーソル座標に固定するためのパン調整
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;
    this.offsetX = mouseX - halfW - worldPos.x * this.scale;
    this.offsetY = mouseY - halfH - worldPos.y * this.scale;

    this.requestRender();

    if (this.onZoomChanged && oldScale !== this.scale) {
      this.onZoomChanged(this.scale);
    }
  }

  // ダブルクリックでルートノード追加
  private handleDblClick(e: MouseEvent) {
    if (this.currentPlaybackTime) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldPos = this.screenToWorld(mouseX, mouseY);
    const hitNode = this.findNodeAt(worldPos);

    // 空白地でのダブルクリックのみ
    if (!hitNode) {
      if (this.onAddRootNode) {
        this.onAddRootNode(worldPos);
      }
    }
  }

  // コンテキストメニュー
  private handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldPos = this.screenToWorld(mouseX, mouseY);
    const hitNode = this.findNodeAt(worldPos);

    if (hitNode && this.onContextMenu) {
      this.setSelectedNodeId(hitNode.id);
      this.onContextMenu(hitNode.id, e.clientX, e.clientY);
    }
  }

  // ==========================================
  // タッチイベントハンドラ（簡易実装）
  // ==========================================


  private handleTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      // ピンチズーム開始
      e.preventDefault();
      this.isPinching = true;
      this.isPanning = false;
      this.draggedNodeId = null;
      this.pinchStartDist = this.getTouchDistance(e.touches);
      this.pinchStartScale = this.scale;
      return;
    }

    if (e.touches.length === 1 && !this.isPinching) {
      const rect = this.canvas.getBoundingClientRect();
      const touchX = e.touches[0].clientX - rect.left;
      const touchY = e.touches[0].clientY - rect.top;
      
      const worldPos = this.screenToWorld(touchX, touchY);

      // 1. エッジ挿入ボタン（またはエッジ中間点）タップ判定
      if (!this.currentPlaybackTime) {
        let bestEdge: Edge | null = null;
        let bestDist = Infinity;
        for (const edge of this.filteredEdges) {
          const pts = this.getEdgePoints(edge);
          if (!pts) continue;
          const dist = Math.hypot(worldPos.x - pts.midX, worldPos.y - pts.midY);
          if (dist < bestDist) {
            bestDist = dist;
            bestEdge = edge;
          }
        }
        if (bestDist <= 20) { // タッチ判定許容値
          if (this.onInsertNodeOnEdge && bestEdge) {
            const pts = this.getEdgePoints(bestEdge);
            if (pts) {
              this.onInsertNodeOnEdge(bestEdge.id, { x: pts.midX, y: pts.midY });
              return;
            }
          }
        }
      }

      // 2. ノード上クリック判定
      const hitNode = this.findNodeAt(worldPos);

      const activeEl = document.activeElement;
      const isEditing = activeEl && activeEl.classList.contains('canvas-textarea');

      if (hitNode) {
        if (isEditing && hitNode.id !== this.selectedNodeId) {
          (activeEl as HTMLElement).blur();
        }

        this.setSelectedNodeId(hitNode.id);
        this.draggedNodeId = hitNode.id;
        this.dragOffset = {
          x: worldPos.x - hitNode.position.x,
          y: worldPos.y - hitNode.position.y,
        };

        // ロングタップの検知（長押しコンテキストメニュー）
        if (this.longTapTimer) window.clearTimeout(this.longTapTimer);
        this.isSwipeSelecting = false;
        this.longTapTimer = window.setTimeout(() => {
          this.longTapTimer = null;
          if (this.onContextMenu && !this.isPanning && !this.isPinching) {
            this.onContextMenu(hitNode.id, e.touches[0].clientX, e.touches[0].clientY);
            this.isSwipeSelecting = true;
            this.draggedNodeId = null;
          }
        }, 500);
      } else {
        if (isEditing) {
          (activeEl as HTMLElement).blur();
        }
        this.isPanning = true;
        this.panStart = { x: touchX - this.offsetX, y: touchY - this.offsetY };
      }
    }
  }

  private handleTouchMove(e: TouchEvent) {
    if (e.touches.length === 2 && this.isPinching) {
      // ピンチズーム処理
      e.preventDefault();
      const currentDist = this.getTouchDistance(e.touches);
      const ratio = currentDist / this.pinchStartDist;
      
      const oldScale = this.scale;
      this.scale = Math.min(Math.max(this.pinchStartScale * ratio, 0.2), 3.0);

      // ピンチ中心を基準にパンオフセットを調整
      const rect = this.canvas.getBoundingClientRect();
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      const halfW = rect.width / 2;
      const halfH = rect.height / 2;

      const worldX = (centerX - halfW - this.offsetX) / oldScale;
      const worldY = (centerY - halfH - this.offsetY) / oldScale;
      this.offsetX = centerX - halfW - worldX * this.scale;
      this.offsetY = centerY - halfH - worldY * this.scale;

      this.requestRender();
      if (this.onZoomChanged) {
        this.onZoomChanged(this.scale);
      }
      return;
    }

    if (e.touches.length === 1 && !this.isPinching) {
      if (this.isSwipeSelecting) {
        if (this.onRadialSwipe) {
          this.onRadialSwipe(e.touches[0].clientX, e.touches[0].clientY);
        }
        return;
      }

      if (this.longTapTimer) {
        window.clearTimeout(this.longTapTimer);
        this.longTapTimer = null;
      }
      const rect = this.canvas.getBoundingClientRect();
      const touchX = e.touches[0].clientX - rect.left;
      const touchY = e.touches[0].clientY - rect.top;

      if (this.isPanning) {
        this.offsetX = touchX - this.panStart.x;
        this.offsetY = touchY - this.panStart.y;
        this.requestRender();
      } else if (this.draggedNodeId && !this.currentPlaybackTime) {
        const worldPos = this.screenToWorld(touchX, touchY);
        const node = this.nodes.find((n) => n.id === this.draggedNodeId);
        if (node) {
          node.position = {
            x: worldPos.x - this.dragOffset.x,
            y: worldPos.y - this.dragOffset.y,
          };
          this.requestRender();
        }
      }
    }
  }

  private handleTouchEnd(e: TouchEvent) {
    if (this.longTapTimer) {
      window.clearTimeout(this.longTapTimer);
      this.longTapTimer = null;
    }

    if (this.isSwipeSelecting) {
      this.isSwipeSelecting = false;
      if (this.onRadialRelease) {
        this.onRadialRelease();
      }
      return;
    }

    // ピンチ終了判定 (指が1本以下になったらピンチ終了)
    if (this.isPinching && e.touches.length < 2) {
      this.isPinching = false;
    }

    if (e.touches.length === 0) {
      this.handleMouseUp();
    }
  }

  // 2点間の距離を計算
  private getTouchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  // ==========================================
  // ヘルパーメソッド
  // ==========================================

  // 指定座標にあるノードを探索
  public findNodeAt(worldPos: Position): MindMapNode | null {
    // 逆順（後から描画されたものが前面にくるため）で探索
    for (let i = this.filteredNodes.length - 1; i >= 0; i--) {
      const node = this.filteredNodes[i];
      const size = this.calculateNodeSize(node);

      const rx = node.position.x - size.width / 2;
      const ry = node.position.y - size.height / 2;

      // 判定にプラスボタンも含む
      const isHovered = node.id === this.hoveredNodeId;
      const rightBoundary = rx + size.width + (isHovered && !this.currentPlaybackTime ? this.PLUS_BTN_OFFSET_X + this.PLUS_BTN_RADIUS : 0);

      if (
        worldPos.x >= rx &&
        worldPos.x <= rightBoundary &&
        worldPos.y >= ry &&
        worldPos.y <= ry + size.height
      ) {
        return node;
      }
    }
    return null;
  }
}
