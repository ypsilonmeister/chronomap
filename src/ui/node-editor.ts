import { MindMapCanvas } from '../canvas';
import { CommandStack, UpdateNodeTextCommand } from '../history';
import { ShortcutManager } from '../shortcuts';
import { AudioSpeechRecognizer } from '../audio';

export class NodeEditorController {
  private activeEditNodeId: string | null = null;
  private activeTextarea: HTMLTextAreaElement | null = null;
  private speechRecognizer: AudioSpeechRecognizer | null = null;

  constructor(
    private canvasManager: MindMapCanvas,
    private commandStack: CommandStack,
    private shortcutManager: ShortcutManager,
    private recordingToast: HTMLDivElement
  ) {}

  public getActiveEditNodeId(): string | null {
    return this.activeEditNodeId;
  }

  // インラインテキスト編集の開始
  public startInlineEdit(nodeId: string) {
    if (this.canvasManager.isInPlaybackMode()) return;

    // 既存のインラインテキストエリアがあれば削除
    this.removeInlineTextarea();

    const node = this.canvasManager.getNodes().find((n) => n.id === nodeId);
    if (!node) return;

    const bounds = this.canvasManager.getNodeScreenBounds(nodeId);
    if (!bounds) return;

    const textarea = document.createElement('textarea');
    textarea.className = 'canvas-textarea';
    textarea.value = node.text;
    
    textarea.style.left = `${bounds.left}px`;
    textarea.style.top = `${bounds.top}px`;
    textarea.style.width = `${bounds.width}px`;
    textarea.style.height = `${bounds.height}px`;
    
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    this.activeEditNodeId = nodeId;
    this.activeTextarea = textarea;

    this.shortcutManager.setEditingState(true);

    const commitEdit = async () => {
      const newText = textarea.value.trim();
      if (newText && newText !== node.text) {
        await this.commandStack.execute(
          new UpdateNodeTextCommand(nodeId, newText)
        );
      }
      cleanup();
    };

    const cleanup = () => {
      textarea.remove();
      if (this.activeTextarea === textarea) {
        this.activeTextarea = null;
        this.activeEditNodeId = null;
      }
      this.shortcutManager.setEditingState(false);
      this.canvasManager.requestRender();
    };

    textarea.addEventListener('blur', commitEdit);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitEdit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      }
    });
  }

  public removeInlineTextarea() {
    const existing = document.querySelector('.canvas-textarea');
    if (existing) {
      existing.remove();
      this.activeEditNodeId = null;
      this.activeTextarea = null;
      this.shortcutManager.setEditingState(false);
    }
  }

  public updateTextareaPosition() {
    if (!this.activeEditNodeId || !this.activeTextarea) return;
    const bounds = this.canvasManager.getNodeScreenBounds(this.activeEditNodeId);
    if (!bounds) return;

    this.activeTextarea.style.left = `${bounds.left}px`;
    this.activeTextarea.style.top = `${bounds.top}px`;
    this.activeTextarea.style.width = `${bounds.width}px`;
    this.activeTextarea.style.height = `${bounds.height}px`;
  }

  // 音声入力のハンドリング
  public startSpeechRecognition(nodeId: string) {
    if (!AudioSpeechRecognizer.isSupported()) {
      alert('お使いのブラウザは音声認識 (Web Speech API) をサポートしていません。Chrome、Edge、Safariなどをご利用ください。');
      return;
    }

    if (this.canvasManager.isInPlaybackMode()) return;
    const node = this.canvasManager.getNodes().find((n) => n.id === nodeId);
    if (!node) return;

    const originalText = node.text;
    let finalResultReceivedText = '';

    this.stopSpeechRecognition();

    this.speechRecognizer = new AudioSpeechRecognizer();
    
    this.speechRecognizer.onResult = (text, isFinal) => {
      node.text = text || '音声を入力中...';
      this.canvasManager.requestRender();
      if (isFinal) {
        finalResultReceivedText = text;
      }
    };

    this.speechRecognizer.onEnd = async () => {
      this.recordingToast.classList.add('hidden');
      
      const finalVal = finalResultReceivedText.trim() || originalText;
      
      if (finalVal !== originalText) {
        node.text = originalText;
        await this.commandStack.execute(
          new UpdateNodeTextCommand(nodeId, finalVal)
        );
      } else {
        node.text = originalText;
        this.canvasManager.requestRender();
      }
    };

    this.speechRecognizer.onError = (err) => {
      console.error('Speech recognition error in UI:', err);
      this.recordingToast.classList.add('hidden');
      node.text = originalText;
      this.canvasManager.requestRender();
    };

    this.recordingToast.classList.remove('hidden');
    this.speechRecognizer.start();
  }

  public stopSpeechRecognition() {
    if (this.speechRecognizer) {
      this.speechRecognizer.stop();
      this.speechRecognizer = null;
    }
    this.recordingToast.classList.add('hidden');
  }
}
