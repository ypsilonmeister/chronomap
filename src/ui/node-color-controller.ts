import { MindMapCanvas } from '../canvas';
import { CommandStack, UpdateNodeColorCommand } from '../history';
import { store } from '../app/store';

export class NodeColorController {
  private toolbarEl: HTMLDivElement;
  private currentSelectedNodeId: string | null = null;

  constructor(
    private canvasManager: MindMapCanvas,
    private commandStack: CommandStack
  ) {
    this.toolbarEl = document.getElementById('node-color-toolbar') as HTMLDivElement;
    this.initEvents();
  }

  private initEvents() {
    // ツールバー内のボタンクリックイベント
    const buttons = this.toolbarEl.querySelectorAll('.color-option-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!this.currentSelectedNodeId || this.canvasManager.isInPlaybackMode()) return;
        
        const color = (btn as HTMLElement).dataset.color;
        const finalColor = color === 'default' ? undefined : color;
        
        // コマンド実行
        await this.commandStack.execute(
          new UpdateNodeColorCommand(this.currentSelectedNodeId, finalColor)
        );
      });
    });

    // Store の購読
    store.subscribe((state) => {
      const selectedId = state.selectedNodeId;
      const isPast = state.playbackTime !== null;
      
      if (!selectedId || isPast) {
        this.toolbarEl.classList.add('hidden');
        this.currentSelectedNodeId = null;
        return;
      }

      this.currentSelectedNodeId = selectedId;
      const selectedNode = state.nodes.find(n => n.id === selectedId);
      if (selectedNode) {
        this.toolbarEl.classList.remove('hidden');
        
        // アクティブなボタンのハイライト更新
        const activeColor = selectedNode.color || 'default';
        buttons.forEach((btn) => {
          const btnColor = (btn as HTMLElement).dataset.color;
          if (btnColor === activeColor) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
      } else {
        this.toolbarEl.classList.add('hidden');
      }
    });
  }
}
