import { createIcons, Plus, Search, CloudLightning, Menu, Undo2, Redo2, Sparkles, HelpCircle, Play, Pause, Edit3, Mic, Image, Trash2, X } from 'lucide';
import { MindMapNode, Position } from './types';
import * as pageRepo from './data/page-repo';
import * as imageRepo from './data/image-repo';
import * as eventlogRepo from './data/eventlog-repo';
import { MindMapCanvas } from './canvas';
import { CommandStack, AddNodeCommand, MoveNodeCommand, UpdateNodeTextCommand, DeleteNodeCommand, AlignNodesCommand } from './history';
import { ShortcutManager } from './shortcuts';
import { SidebarManager } from './sidebar';
import { AudioSpeechRecognizer } from './audio';
import { MediaManager } from './media';
import { RadialMenuManager } from './radial-menu';
import { PlaybackManager } from './playback';
import { GoogleDriveSyncManager } from './sync';
import { store } from './app/store';

import { isRootNode, findRootNode } from './domain/graph';
import { runAutoLayout } from './domain/layout';
import { calculateChildNodePosition, calculateSiblingNodePosition } from './domain/node-placement';

// グローバル状態
let currentPageId: string | null = null;
let canvasManager: MindMapCanvas | null = null;
let commandStack: CommandStack | null = null;
let shortcutManager: ShortcutManager | null = null;
let sidebarManager: SidebarManager | null = null;
let radialMenuManager: RadialMenuManager | null = null;
let playbackManager: PlaybackManager | null = null;
let syncManager: GoogleDriveSyncManager | null = null;
let activeEditNodeId: string | null = null;
let activeTextarea: HTMLTextAreaElement | null = null;
let speechRecognizer: AudioSpeechRecognizer | null = null;

// DOM 要素キャッシュ
let undoBtn: HTMLButtonElement;
let redoBtn: HTMLButtonElement;
let alignBtn: HTMLButtonElement;
let currentPageTitleInput: HTMLInputElement;
let zoomLevelSpan: HTMLSpanElement;
let zoomFitBtn: HTMLButtonElement;
let zoomResetBtn: HTMLButtonElement;
let recordingToast: HTMLDivElement;
let stopRecordingBtn: HTMLButtonElement;
let syncBtn: HTMLButtonElement;
let syncStatusText: HTMLSpanElement;

// Lucideアイコンの初期化
function initIcons() {
  createIcons({
    icons: {
      Plus,
      Search,
      CloudLightning,
      Menu,
      Undo2,
      Redo2,
      Sparkles,
      HelpCircle,
      Play,
      Pause,
      Edit3,
      Mic,
      Image,
      Trash2,
      X
    }
  });
}

// インラインテキスト編集の開始
function startInlineEdit(nodeId: string) {
  if (!canvasManager || !currentPageId || canvasManager.isInPlaybackMode()) return;

  // 既存のインラインテキストエリアがあれば削除
  removeInlineTextarea();

  const node = canvasManager.getNodes().find((n) => n.id === nodeId);
  if (!node) return;

  const bounds = canvasManager.getNodeScreenBounds(nodeId);
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

  activeEditNodeId = nodeId;
  activeTextarea = textarea;

  if (shortcutManager) {
    shortcutManager.setEditingState(true);
  }

  const commitEdit = async () => {
    const newText = textarea.value.trim();
    if (newText && newText !== node.text && commandStack) {
      await commandStack.execute(
        new UpdateNodeTextCommand(nodeId, newText)
      );
    }
    cleanup();
  };

  const cleanup = () => {
    textarea.remove();
    if (activeTextarea === textarea) {
      activeTextarea = null;
      activeEditNodeId = null;
    }
    if (shortcutManager) {
      shortcutManager.setEditingState(false);
    }
    if (canvasManager) {
      canvasManager.requestRender();
    }
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

function removeInlineTextarea() {
  const existing = document.querySelector('.canvas-textarea');
  if (existing) {
    existing.remove();
    activeEditNodeId = null;
    activeTextarea = null;
    if (shortcutManager) {
      shortcutManager.setEditingState(false);
    }
  }
}

function updateTextareaPosition() {
  if (!activeEditNodeId || !activeTextarea || !canvasManager) return;
  const bounds = canvasManager.getNodeScreenBounds(activeEditNodeId);
  if (!bounds) return;

  activeTextarea.style.left = `${bounds.left}px`;
  activeTextarea.style.top = `${bounds.top}px`;
  activeTextarea.style.width = `${bounds.width}px`;
  activeTextarea.style.height = `${bounds.height}px`;
}

// 音声入力のハンドリング
function startSpeechRecognition(nodeId: string) {
  if (!AudioSpeechRecognizer.isSupported()) {
    alert('お使いのブラウザは音声認識 (Web Speech API) をサポートしていません。Chrome、Edge、Safariなどをご利用ください。');
    return;
  }

  if (!canvasManager || canvasManager.isInPlaybackMode()) return;
  const node = canvasManager.getNodes().find((n) => n.id === nodeId);
  if (!node) return;

  const originalText = node.text;
  let finalResultReceivedText = '';

  stopSpeechRecognition();

  speechRecognizer = new AudioSpeechRecognizer();
  
  speechRecognizer.onResult = (text, isFinal) => {
    node.text = text || '音声を入力中...';
    canvasManager?.requestRender();
    if (isFinal) {
      finalResultReceivedText = text;
    }
  };

  speechRecognizer.onEnd = async () => {
    recordingToast.classList.add('hidden');
    
    const finalVal = finalResultReceivedText.trim() || originalText;
    
    if (finalVal !== originalText && commandStack) {
      node.text = originalText;
      await commandStack.execute(
        new UpdateNodeTextCommand(nodeId, finalVal)
      );
    } else {
      node.text = originalText;
      canvasManager?.requestRender();
    }
  };

  speechRecognizer.onError = (err) => {
    console.error('Speech recognition error in UI:', err);
    recordingToast.classList.add('hidden');
    node.text = originalText;
    canvasManager?.requestRender();
  };

  recordingToast.classList.remove('hidden');
  speechRecognizer.start();
}

function stopSpeechRecognition() {
  if (speechRecognizer) {
    speechRecognizer.stop();
    speechRecognizer = null;
  }
  recordingToast.classList.add('hidden');
}

// UIイベントの初期化
function initUIEvents() {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const helpBtn = document.getElementById('help-btn');
  const helpModal = document.getElementById('help-modal');
  const closeHelpBtn = document.getElementById('close-help-btn');

  // サイドバー表示切替
  if (sidebar && sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        sidebar.classList.toggle('show');
      } else {
        sidebar.classList.toggle('hidden');
      }
      setTimeout(() => {
        if (canvasManager) canvasManager.resize();
      }, 300);
    });

    // モバイル環境でサイドバー外をタップしたら閉じる
    document.addEventListener('touchstart', (e) => {
      if (window.innerWidth <= 768 && sidebar.classList.contains('show')) {
        const target = e.target as HTMLElement;
        if (!sidebar.contains(target) && !sidebarToggleBtn.contains(target)) {
          sidebar.classList.remove('show');
        }
      }
    }, { passive: true });
    
    document.addEventListener('mousedown', (e) => {
      if (window.innerWidth <= 768 && sidebar.classList.contains('show')) {
        const target = e.target as HTMLElement;
        if (!sidebar.contains(target) && !sidebarToggleBtn.contains(target)) {
          sidebar.classList.remove('show');
        }
      }
    });
  }

  // ヘルプモーダルの開閉
  if (helpBtn && helpModal && closeHelpBtn) {
    helpBtn.addEventListener('click', () => {
      helpModal.classList.remove('hidden');
    });
    closeHelpBtn.addEventListener('click', () => {
      helpModal.classList.add('hidden');
    });
    const backdrop = helpModal.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => {
        helpModal.classList.add('hidden');
      });
    }
  }

  // Undo / Redo ボタンのクリック
  undoBtn.addEventListener('click', () => {
    if (commandStack) commandStack.undo();
  });
  
  redoBtn.addEventListener('click', () => {
    if (commandStack) commandStack.redo();
  });

  // ズームフィットボタン
  zoomFitBtn.addEventListener('click', () => {
    if (canvasManager) canvasManager.fitToScreen();
  });

  // ズームリセットボタン
  zoomResetBtn.addEventListener('click', () => {
    if (canvasManager) canvasManager.resetZoom();
  });

  // 音声入力停止ボタン
  stopRecordingBtn.addEventListener('click', () => {
    stopSpeechRecognition();
  });

  // ページタイトル変更処理
  const commitPageTitle = async () => {
    if (!currentPageId || !sidebarManager) return;
    const newTitle = currentPageTitleInput.value.trim() || '無題のノート';
    currentPageTitleInput.value = newTitle;
    
    await pageRepo.updatePage(currentPageId, { title: newTitle });
    
    await eventlogRepo.addHistory({
      pageId: currentPageId,
      timestamp: new Date().toISOString(),
      action: 'update_page_title',
      payload: { title: newTitle }
    });

    await store.reloadPages(currentPageId);
  };

  currentPageTitleInput.addEventListener('blur', commitPageTitle);
  currentPageTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      currentPageTitleInput.blur();
    }
  });
}

async function triggerAutoLayout() {
  if (!currentPageId || !canvasManager || !commandStack || canvasManager.isInPlaybackMode()) return;

  const nodes = [...canvasManager.getNodes()];
  const edges = [...canvasManager.getEdges()];
  const rootNode = findRootNode(nodes, edges);
  if (!rootNode) return;

  const newPositions = new Map<string, Position>();
  const nodesCopy = nodes.map((n) => ({ ...n, position: { ...n.position } }));
  runAutoLayout(nodesCopy, edges, rootNode, newPositions);

  await commandStack.execute(
    new AlignNodesCommand(currentPageId, newPositions)
  );
}

// ドキュメント読み込み完了時の処理
document.addEventListener('DOMContentLoaded', async () => {
  // DOMキャッシュ取得
  undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
  redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;
  alignBtn = document.getElementById('align-btn') as HTMLButtonElement;
  currentPageTitleInput = document.getElementById('current-page-title') as HTMLInputElement;
  zoomLevelSpan = document.getElementById('zoom-level') as HTMLSpanElement;
  zoomFitBtn = document.getElementById('zoom-fit-btn') as HTMLButtonElement;
  zoomResetBtn = document.getElementById('zoom-reset-btn') as HTMLButtonElement;
  recordingToast = document.getElementById('recording-toast') as HTMLDivElement;
  stopRecordingBtn = document.getElementById('stop-recording-btn') as HTMLButtonElement;
  syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;
  syncStatusText = document.getElementById('sync-status-text') as HTMLSpanElement;

  initIcons();
  initUIEvents();

  // 1. Canvasの初期化
  try {
    canvasManager = new MindMapCanvas('mindmap-canvas');
    canvasManager.resize();
    window.addEventListener('resize', () => {
      if (canvasManager) canvasManager.resize();
    });
  } catch (err) {
    console.error('Canvas initialization failed:', err);
    return;
  }

  // 2. Undo/Redoスタックの初期化
  commandStack = new CommandStack(() => {
    if (commandStack) {
      const isPast = canvasManager?.isInPlaybackMode();
      undoBtn.disabled = isPast || !commandStack.canUndo();
      redoBtn.disabled = isPast || !commandStack.canRedo();
    }
  });

  // 3. Canvasのイベントコールバック設定
  canvasManager.onRender = () => {
    updateTextareaPosition();
  };

  canvasManager.onZoomChanged = (scale) => {
    zoomLevelSpan.textContent = `${Math.round(scale * 100)}%`;
  };

  canvasManager.onNodeMoved = async (nodeId, pos) => {
    if (commandStack) {
      await commandStack.execute(
        new MoveNodeCommand(nodeId, pos)
      );
    }
  };

  canvasManager.onAddChildNode = async (parentNodeId) => {
    if (!currentPageId || !commandStack || !canvasManager || canvasManager.isInPlaybackMode()) return;
    
    const nodes = [...canvasManager.getNodes()];
    const edges = [...canvasManager.getEdges()];
    
    const newPos = calculateChildNodePosition(parentNodeId, nodes, edges);
    if (!newPos) return;

    const createdOut = { node: null as MindMapNode | null };

    await commandStack.execute(
      new AddNodeCommand(
        {
          pageId: currentPageId,
          text: '新規ノード',
          media: {
            hasImage: false,
            imageRef: '',
            hasAudio: false,
            audioRef: ''
          },
          position: newPos
        },
        parentNodeId,
        createdOut
      )
    );

    if (createdOut.node) {
      setTimeout(() => {
        if (createdOut.node) {
          if (window.innerWidth > 768) {
            startInlineEdit(createdOut.node.id);
          } else {
            canvasManager?.setSelectedNodeId(createdOut.node.id);
          }
        }
      }, 100);
    }
  };

  canvasManager.onAddRootNode = async (pos) => {
    if (!currentPageId || !commandStack || !canvasManager || canvasManager.isInPlaybackMode()) return;

    // 既にルートノード（親エッジを持たないノード）が存在するかチェック
    const nodes = canvasManager.getNodes();
    const edges = canvasManager.getEdges();
    const hasRoot = nodes.some((node) => isRootNode(node.id, edges));
    if (hasRoot) {
      return;
    }

    const createdOut = { node: null as MindMapNode | null };

    await commandStack.execute(
      new AddNodeCommand(
        {
          pageId: currentPageId,
          text: '新規テーマ',
          media: {
            hasImage: false,
            imageRef: '',
            hasAudio: false,
            audioRef: ''
          },
          position: pos
        },
        null,
        createdOut
      )
    );

    if (createdOut.node) {
      setTimeout(() => {
        if (createdOut.node) {
          if (window.innerWidth > 768) {
            startInlineEdit(createdOut.node.id);
          } else {
            canvasManager?.setSelectedNodeId(createdOut.node.id);
          }
        }
      }, 100);
    }
  };

  // 4. 放射状メニューマネージャーの初期化
  radialMenuManager = new RadialMenuManager();
  
  canvasManager.onContextMenu = (nodeId, clientX, clientY) => {
    if (canvasManager?.isInPlaybackMode()) return;

    radialMenuManager?.show(nodeId, clientX, clientY, {
      onEditText: (id) => {
        startInlineEdit(id);
      },
      onAudioInput: (id) => {
        startSpeechRecognition(id);
      },
      onAttachImage: async (id) => {
        await MediaManager.attachImageToNode(
          id,
          async () => {
            canvasManager?.clearImageCache();
            if (currentPageId) {
              await store.reloadPageData(currentPageId);
            }
          },
          (err) => {
            alert(`写真の添付に失敗しました: ${err.message || err}`);
          }
        );
      },
      onDeleteNode: async (id) => {
        if (confirm('このノードとすべての子ノードを削除しますか？')) {
          if (commandStack && currentPageId) {
            await commandStack.execute(
              new DeleteNodeCommand(id)
            );
          }
        }
      }
    });
  };

  canvasManager.onRadialSwipe = (clientX, clientY) => {
    radialMenuManager?.updateHighlight(clientX, clientY);
  };

  canvasManager.onRadialRelease = () => {
    radialMenuManager?.executeActiveAction();
  };

  // 写真拡大表示用モーダル処理
  const imageModal = document.getElementById('image-modal') as HTMLElement;
  const modalImage = document.getElementById('modal-image') as HTMLImageElement;
  const closeModalBtn = document.getElementById('close-modal-btn') as HTMLButtonElement;
  
  canvasManager.getCanvasElement().addEventListener('click', async (e) => {
    if (!canvasManager) return;
    const rect = canvasManager.getCanvasElement().getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    if (e.target !== canvasManager.getCanvasElement() || document.querySelector('.canvas-textarea') || (radialMenuManager && radialMenuManager.isVisible())) {
      return;
    }

    const worldPos = canvasManager.screenToWorld(mouseX, mouseY);
    const hitNode = canvasManager.findNodeAt(worldPos);

    if (hitNode && hitNode.media.hasImage && hitNode.media.imageRef) {
      if (canvasManager.isPositionOnPlusButton(hitNode.id, worldPos)) {
        return;
      }

      if (canvasManager.isPositionOnNodeImage(hitNode.id, worldPos)) {
        let displaySrc = hitNode.media.imageRef;
        
        const dbImageKey = `img-${hitNode.id}`;
        const dbBlob = await imageRepo.getImage(dbImageKey);
        if (dbBlob) {
          displaySrc = URL.createObjectURL(dbBlob);
        }

        modalImage.src = displaySrc;
        imageModal.classList.remove('hidden');
      }
    }
  });

  if (imageModal && closeModalBtn) {
    closeModalBtn.addEventListener('click', () => {
      imageModal.classList.add('hidden');
    });
    imageModal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
      imageModal.classList.add('hidden');
    });
  }

  // 5. ショートカットキーの登録
  shortcutManager = new ShortcutManager(
    () => (canvasManager ? canvasManager.getSelectedNodeId() : null),
    {
      onUndo: () => {
        if (commandStack && commandStack.canUndo() && !canvasManager?.isInPlaybackMode()) {
          commandStack.undo();
        }
      },
      onRedo: () => {
        if (commandStack && commandStack.canRedo() && !canvasManager?.isInPlaybackMode()) {
          commandStack.redo();
        }
      },
      onAddSibling: async (nodeId) => {
        if (!currentPageId || !commandStack || !canvasManager || canvasManager.isInPlaybackMode()) return;
        
        const edges = store.getState().edges;
        const parentEdge = edges.find((e) => e.target === nodeId);
        const parentId = parentEdge ? parentEdge.source : null;

        if (parentId === null) {
          // ルートノードの兄弟ノード（新たなルート）は作成できない
          return;
        }

        const nodes = [...canvasManager.getNodes()];
        const node = nodes.find((n) => n.id === nodeId);
        if (!node) return;

        const newPos = calculateSiblingNodePosition(nodeId, nodes);
        if (!newPos) return;

        const createdOut = { node: null as MindMapNode | null };

        await commandStack.execute(
          new AddNodeCommand(
            {
              pageId: currentPageId,
              text: '新規ノード',
              media: {
                hasImage: false,
                imageRef: '',
                hasAudio: false,
                audioRef: ''
              },
              position: newPos
            },
            parentId,
            createdOut
          )
        );

        if (createdOut.node) {
          setTimeout(() => {
            if (createdOut.node) {
              if (window.innerWidth > 768) {
                startInlineEdit(createdOut.node.id);
              } else {
                canvasManager?.setSelectedNodeId(createdOut.node.id);
              }
            }
          }, 100);
        }
      },
      onAddChild: (nodeId) => {
        if (canvasManager && canvasManager.onAddChildNode) {
          canvasManager.onAddChildNode(nodeId);
        }
      },
      onDeleteNode: async (nodeId) => {
        if (canvasManager?.isInPlaybackMode()) return;
        if (confirm('このノードとすべての子ノードを削除しますか？')) {
          if (commandStack && currentPageId) {
            await commandStack.execute(
              new DeleteNodeCommand(nodeId)
            );
          }
        }
      },
      onEditText: (nodeId) => {
        startInlineEdit(nodeId);
      },
      onAlign: () => {
        triggerAutoLayout();
      },
      onZoomFit: () => {
        if (canvasManager) canvasManager.fitToScreen();
      }
    }
  );

  alignBtn.addEventListener('click', () => {
    triggerAutoLayout();
  });

  // 6. タイムライン再生の初期化
  playbackManager = new PlaybackManager();
  
  // 7. Google Drive同期マネージャーの初期化
  syncManager = new GoogleDriveSyncManager();

  // 8. サイドバーマネージャー初期化
  sidebarManager = new SidebarManager();

  // 9. Store 購読による UI 制御の一本化
  let lastTimelinePageId: string | null = null;
  let lastTimelineNodeCount = 0;
  let lastSyncStatus: string | null = null;

  store.subscribe(async (state) => {
    // ページタイトル・状態管理の反映
    if (state.currentPageId !== currentPageId) {
      const oldPageId = currentPageId;
      currentPageId = state.currentPageId;
      
      if (currentPageId) {
        const page = state.pages.find(p => p.pageId === currentPageId);
        if (page) {
          currentPageTitleInput.value = page.title;
          currentPageTitleInput.disabled = false;
        }
        
        // ページ切り替え時はスタックをクリアする
        if (oldPageId !== null && commandStack) {
          commandStack.clear();
        }
      } else {
        currentPageTitleInput.value = '';
        currentPageTitleInput.disabled = true;
      }
      
      if (radialMenuManager) radialMenuManager.hide();
      removeInlineTextarea();
      stopSpeechRecognition();
    }

    // タイムライン再生時間に応じた UI 状態制御
    const isPast = state.playbackTime !== null;
    undoBtn.disabled = isPast || (commandStack ? !commandStack.canUndo() : true);
    redoBtn.disabled = isPast || (commandStack ? !commandStack.canRedo() : true);
    alignBtn.disabled = isPast;
    currentPageTitleInput.disabled = isPast;

    const newPageBtn = document.getElementById('new-page-btn') as HTMLButtonElement;
    if (newPageBtn) newPageBtn.disabled = isPast;

    if (isPast) {
      removeInlineTextarea();
      radialMenuManager?.hide();
      stopSpeechRecognition();
    }

    // タイムラインの初期化・更新
    if (state.currentPageId && (state.currentPageId !== lastTimelinePageId || state.nodes.length !== lastTimelineNodeCount)) {
      lastTimelinePageId = state.currentPageId;
      lastTimelineNodeCount = state.nodes.length;
      if (playbackManager) {
        const isPlaying = playbackManager.getIsPlaying();
        await playbackManager.initPage(state.currentPageId);
        if (isPlaying) {
          playbackManager.play();
        }
      }
    } else if (!state.currentPageId && lastTimelinePageId !== null) {
      lastTimelinePageId = null;
      lastTimelineNodeCount = 0;
      if (playbackManager) {
        await playbackManager.initPage('');
      }
    }

    // 同期状態の UI 反映
    const { status, msg } = state.syncStatus;
    if (status !== lastSyncStatus) {
      lastSyncStatus = status;
      console.log(`Sync status in UI: ${status} (${msg || ''})`);

      if (syncStatusText && syncBtn) {
        switch (status) {
          case 'syncing':
            syncStatusText.textContent = msg || '同期中...';
            syncBtn.disabled = true;
            break;
          case 'offline':
            syncStatusText.textContent = 'オフライン (同期不可)';
            syncBtn.disabled = true;
            break;
          case 'authenticated':
            syncStatusText.textContent = '認証成功 (同期開始)';
            syncBtn.disabled = true;
            break;
          case 'error':
            syncStatusText.textContent = '同期エラー (再接続)';
            syncBtn.disabled = false;
            break;
          case 'idle':
          default:
            syncStatusText.textContent = 'Google Drive 同期';
            syncBtn.disabled = false;
            break;
        }
      }
    }
  });

  // 同期ボタンクリックイベント
  syncBtn.addEventListener('click', () => {
    if (syncManager) {
      if (syncManager.isAuthenticated()) {
        syncManager.sync();
      } else {
        syncManager.login();
      }
    }
  });

  // 同期マネージャーの初期化を実行
  console.log('Initializing sync manager...');
  syncManager.initialize().then((success) => {
    console.log('Sync manager initialization finished. Success:', success);
  }).catch((err) => {
    console.error('Sync manager initialization failed with error:', err);
  });

  // アプリケーションとストアの初期化を実行
  console.log('Initializing AppStore...');
  await store.initialize();
});
