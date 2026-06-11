import * as db from './db';
import { MindMapCanvas } from './canvas';
import { createIcons, Play, Pause } from 'lucide';

export class PlaybackManager {
  private canvas: MindMapCanvas;
  
  // DOM
  private slider: HTMLInputElement;
  private playBtn: HTMLButtonElement;
  private currentTimeText: HTMLSpanElement;
  private maxTimeText: HTMLSpanElement;
  private speedSelect: HTMLSelectElement;

  // 状態
  private minTime = 0;
  private maxTime = 0;
  private currentTime = 0;
  private isPlaying = false;
  private targetDurationSeconds = 30;
  private lastFrameTime = 0;
  private animationFrameId: number | null = null;

  // コールバック
  public onTimeChanged: ((timeIso: string | null) => void) | null = null;

  constructor(canvas: MindMapCanvas) {
    this.canvas = canvas;

    this.slider = document.getElementById('timeline-slider') as HTMLInputElement;
    this.playBtn = document.getElementById('play-btn') as HTMLButtonElement;
    this.currentTimeText = document.getElementById('current-time-text') as HTMLSpanElement;
    this.maxTimeText = document.getElementById('max-time-text') as HTMLSpanElement;
    this.speedSelect = document.getElementById('speed-select') as HTMLSelectElement;
    this.targetDurationSeconds = parseInt(this.speedSelect.value, 10) || 30;

    this.initEvents();
  }

  // 対象ページの初期化
  public async initPage(pageId: string) {
    this.stop();

    const nodes = await db.getNodesByPage(pageId);
    const edges = await db.getEdgesByPage(pageId);

    if (nodes.length === 0) {
      // ノードがない場合は無効化
      this.minTime = Date.now();
      this.maxTime = this.minTime;
      this.slider.disabled = true;
      this.playBtn.disabled = true;
      this.updateTimeDisplay();
      return;
    }

    this.slider.disabled = false;
    this.playBtn.disabled = false;

    // 時間範囲の計算 (最古の createdAt から 最新の updatedAt)
    let minMs = Infinity;
    let maxMs = -Infinity;

    for (const node of nodes) {
      const created = new Date(node.createdAt).getTime();
      const updated = new Date(node.updatedAt).getTime();
      if (created < minMs) minMs = created;
      if (updated > maxMs) maxMs = updated;
    }

    for (const edge of edges) {
      const created = new Date(edge.createdAt).getTime();
      if (created < minMs) minMs = created;
      // エッジの更新時間は通常考慮しないが作成時間は考慮
      if (created > maxMs) maxMs = created;
    }

    // もし極端な誤差があった場合や同一時刻だった場合のバッファ
    if (minMs === maxMs) {
      minMs -= 5000; // 5秒前
      maxMs += 5000; // 5秒後
    }

    this.minTime = minMs;
    this.maxTime = maxMs;

    this.slider.min = minMs.toString();
    this.slider.max = maxMs.toString();
    
    // 初期状態は現在時間 (最新)
    this.currentTime = maxMs;
    this.slider.value = maxMs.toString();

    this.updateTimeDisplay();
  }

  // イベントリスナーの登録
  private initEvents() {
    // スライダーの手動ドラッグ
    this.slider.addEventListener('input', () => {
      this.currentTime = parseInt(this.slider.value, 10);
      this.updateTimeDisplay();
      this.notifyTimeChange();
    });

    // 再生ボタン
    this.playBtn.addEventListener('click', () => {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    });

    // 速度選択
    this.speedSelect.addEventListener('change', () => {
      this.targetDurationSeconds = parseInt(this.speedSelect.value, 10);
    });
  }

  // 再生開始
  public play() {
    if (this.isPlaying) return;

    // もし既に最大時間 (右端) に達している場合は、最初から再生する
    if (this.currentTime >= this.maxTime) {
      this.currentTime = this.minTime;
      this.slider.value = this.minTime.toString();
    }

    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.playBtn.innerHTML = '<i data-lucide="pause"></i>';
    this.playBtn.title = '一時停止';
    
    createIcons({ icons: { Pause } });

    const tick = (now: number) => {
      if (!this.isPlaying) return;

      const dt = (now - this.lastFrameTime) / 1000; // 秒単位
      this.lastFrameTime = now;

      // 仮想時間を進める (dt * 速度)
      const totalTimelineMs = this.maxTime - this.minTime;
      const virtualSpeed = totalTimelineMs > 0 ? totalTimelineMs / (this.targetDurationSeconds * 1000) : 1;
      this.currentTime += dt * 1000 * virtualSpeed;

      if (this.currentTime >= this.maxTime) {
        this.currentTime = this.maxTime;
        this.slider.value = this.maxTime.toString();
        this.stop(); // 右端に到達したら自動停止
      } else {
        this.slider.value = this.currentTime.toString();
        this.updateTimeDisplay();
        this.notifyTimeChange();
        this.animationFrameId = requestAnimationFrame(tick);
      }
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  // 一時停止
  public pause() {
    this.isPlaying = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.playBtn.innerHTML = '<i data-lucide="play"></i>';
    this.playBtn.title = '自動再生';
    
    createIcons({ icons: { Play } });
  }

  // 停止
  public stop() {
    this.pause();
    this.currentTime = this.maxTime;
    this.slider.value = this.maxTime.toString();
    this.updateTimeDisplay();
    this.notifyTimeChange();
  }

  // 時間変更通知
  private notifyTimeChange() {
    // スライダーが最大時間 (右端) にあるときは、フィルターなしの最新状態とする (null)
    const isAtEnd = Math.abs(this.currentTime - this.maxTime) < 1000; // 1秒未満の差
    const isoString = isAtEnd ? null : new Date(this.currentTime).toISOString();
    
    this.canvas.setPlaybackTime(isoString);

    if (this.onTimeChanged) {
      this.onTimeChanged(isoString);
    }
  }

  // 時刻表示テキストの更新
  private updateTimeDisplay() {
    if (this.minTime === this.maxTime) {
      this.currentTimeText.textContent = '--:--:--';
      this.maxTimeText.textContent = '--:--:--';
      return;
    }

    this.currentTimeText.textContent = this.formatTime(this.currentTime);
    this.maxTimeText.textContent = this.formatTime(this.maxTime);
  }

  // 時刻のフォーマット (hh:mm:ss)
  private formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
}
