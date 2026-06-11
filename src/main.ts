import { createIcons, Plus, Search, CloudLightning, Menu, Undo2, Redo2, Sparkles, HelpCircle, Play, Pause, Edit3, Mic, Image, Trash2, X } from 'lucide';
import { MindMapNode, Edge, Position } from './types';
import * as db from './db';
import { MindMapCanvas } from './canvas';
import { CommandStack, AddNodeCommand, MoveNodeCommand, UpdateNodeTextCommand, DeleteNodeCommand, AlignNodesCommand } from './history';
import { ShortcutManager } from './shortcuts';
import { SidebarManager } from './sidebar';
import { AudioSpeechRecognizer } from './audio';
import { MediaManager } from './media';
import { ContextMenuManager } from './context-menu';
import { PlaybackManager } from './playback';
import { GoogleDriveSyncManager } from './sync';

// グローバル状態
let currentPageId: string | null = null;
let canvasManager: MindMapCanvas | null = null;
let commandStack: CommandStack | null = null;
let shortcutManager: ShortcutManager | null = null;
let sidebarManager: SidebarManager | null = null;
let contextMenuManager: ContextMenuManager | null = null;
let speechRecognizer: AudioSpeechRecognizer | null = null;
let playbackManager: PlaybackManager | null = null;
let syncManager: GoogleDriveSyncManager | null = null;
let activeEditNodeId: string | null = null;
let activeTextarea: HTMLTextAreaElement | null = null;

// DOM 要素キャッシュ
let undoBtn: HTMLButtonElement;
let redoBtn: HTMLButtonElement;
let alignBtn: HTMLButtonElement;
let currentPageTitleInput: HTMLInputElement;
let zoomLevelSpan: HTMLSpanElement;
let zoomResetBtn: HTMLButtonElement;
let recordingToast: HTMLElement;
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

// ページ切り替え処理
async function selectPage(pageId: string) {
  currentPageId = pageId;
  const page = await db.getPage(pageId);
  if (!page) return;

  // ヘッダータイトル更新
  currentPageTitleInput.value = page.title;
  currentPageTitleInput.disabled = false;

  // タイムラインの初期化
  if (playbackManager) {
    await playbackManager.initPage(pageId);
  }

  // データのロードとCanvas描画
  await loadAndRenderCanvas();

  // Undo/Redoスタックのクリア
  if (commandStack) {
    commandStack.clear();
  }

  // ノードコンテキストメニューやインラインテキストエリアは非表示にする
  if (contextMenuManager) contextMenuManager.hide();
  removeInlineTextarea();
  stopSpeechRecognition();
}

// データの再ロードとCanvasの更新
async function loadAndRenderCanvas() {
  if (!currentPageId || !canvasManager) return;
  const rawNodes = await db.getNodesByPage(currentPageId);
  const edges = await db.getEdgesByPage(currentPageId);

  // 画像の Local Blob URL を復元して適用
  const nodes: MindMapNode[] = [];
  for (const node of rawNodes) {
    const clonedNode = { ...node };
    if (node.media.hasImage && node.media.imageRef) {
      // IndexedDB 内の Blob からローカル URL を生成
      const blobUrl = await MediaManager.loadAndCreateImageURL(node.media.imageRef);
      if (blobUrl) {
        clonedNode.media = {
          ...node.media,
          imageRef: blobUrl
        };
      }
    }
    nodes.push(clonedNode);
  }

  canvasManager.setData(nodes, edges);
}

// タイムラインの範囲時間更新
async function refreshTimeline() {
  if (currentPageId && playbackManager) {
    const isPlaying = playbackManager['isPlaying'];
    await playbackManager.initPage(currentPageId);
    if (isPlaying) {
      playbackManager.play();
    }
  }
}

// ページ削除時のフォールバック処理
async function handlePageDeleted(deletedPageId: string) {
  if (currentPageId === deletedPageId) {
    const pages = await db.getAllPages();
    if (pages.length > 0) {
      await selectPage(pages[0].pageId);
      if (sidebarManager) {
        await sidebarManager.loadPages(pages[0].pageId);
      }
    } else {
      // 全ノート削除時
      currentPageId = null;
      currentPageTitleInput.value = 'ノートがありません';
      currentPageTitleInput.disabled = true;
      if (canvasManager) {
        canvasManager.setData([], []);
      }
      if (sidebarManager) {
        await sidebarManager.loadPages(null);
      }
      if (playbackManager) {
        await playbackManager.initPage(''); // クリア
      }
    }
  } else {
    if (sidebarManager) {
      await sidebarManager.loadPages(currentPageId);
    }
  }
}

// ページ新規作成・複製時の処理
async function handlePageCreated(newPageId: string) {
  await selectPage(newPageId);
}

// インラインテキスト編集の開始
function startInlineEdit(nodeId: string) {
  if (!canvasManager || !currentPageId || canvasManager['currentPlaybackTime']) return;

  // 既存のインラインテキストエリアがあれば削除
  removeInlineTextarea();

  const node = canvasManager['nodes'].find((n) => n.id === nodeId);
  if (!node) return;

  const size = canvasManager['calculateNodeSize'](node);
  
  const rect = canvasManager['canvas'].getBoundingClientRect();
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  
  const screenX = (node.position.x * canvasManager['scale']) + halfW + canvasManager['offsetX'];
  const screenY = (node.position.y * canvasManager['scale']) + halfH + canvasManager['offsetY'];
  const screenW = size.width * canvasManager['scale'];
  const screenH = size.height * canvasManager['scale'];

  const textarea = document.createElement('textarea');
  textarea.className = 'canvas-textarea';
  textarea.value = node.text;
  
  textarea.style.left = `${rect.left + screenX - screenW / 2}px`;
  textarea.style.top = `${rect.top + screenY - screenH / 2}px`;
  textarea.style.width = `${screenW}px`;
  textarea.style.height = `${screenH}px`;
  
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
        new UpdateNodeTextCommand(nodeId, newText, async () => {
          await loadAndRenderCanvas();
          await refreshTimeline();
          if (sidebarManager) sidebarManager.loadPages(currentPageId);
        })
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
  const node = canvasManager['nodes'].find((n) => n.id === activeEditNodeId);
  if (!node) return;

  const size = canvasManager['calculateNodeSize'](node);
  const rect = canvasManager['canvas'].getBoundingClientRect();
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  
  const screenX = (node.position.x * canvasManager['scale']) + halfW + canvasManager['offsetX'];
  const screenY = (node.position.y * canvasManager['scale']) + halfH + canvasManager['offsetY'];
  const screenW = size.width * canvasManager['scale'];
  const screenH = size.height * canvasManager['scale'];

  activeTextarea.style.left = `${rect.left + screenX - screenW / 2}px`;
  activeTextarea.style.top = `${rect.top + screenY - screenH / 2}px`;
  activeTextarea.style.width = `${screenW}px`;
  activeTextarea.style.height = `${screenH}px`;
}

// 音声入力のハンドリング
function startSpeechRecognition(nodeId: string) {
  if (!AudioSpeechRecognizer.isSupported()) {
    alert('お使いのブラウザは音声認識 (Web Speech API) をサポートしていません。Chrome、Edge、Safariなどをご利用ください。');
    return;
  }

  if (!canvasManager || canvasManager['currentPlaybackTime']) return;
  const node = canvasManager['nodes'].find((n) => n.id === nodeId);
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
        new UpdateNodeTextCommand(nodeId, finalVal, async () => {
          await loadAndRenderCanvas();
          await refreshTimeline();
          if (sidebarManager) sidebarManager.loadPages(currentPageId);
        })
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
    
    await db.updatePage(currentPageId, { title: newTitle });
    
    await db.addHistory({
      pageId: currentPageId,
      timestamp: new Date().toISOString(),
      action: 'update_page_title',
      payload: { title: newTitle }
    });

    await sidebarManager.loadPages(currentPageId);
  };

  currentPageTitleInput.addEventListener('blur', commitPageTitle);
  currentPageTitleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      currentPageTitleInput.blur();
    }
  });
}

// 自動整列の座標計算アルゴリズム
function runAutoLayout(
  nodes: MindMapNode[],
  edges: Edge[],
  rootNode: MindMapNode,
  canvas: MindMapCanvas,
  outPositions: Map<string, Position>
) {
  const getChildren = (nodeId: string) => {
    return nodes.filter((n) => edges.some((e) => e.source === nodeId && e.target === n.id));
  };

  const children = getChildren(rootNode.id);
  const rightChildren = children.filter((c) => c.position.x >= rootNode.position.x);
  const leftChildren = children.filter((c) => c.position.x < rootNode.position.x);

  const spacingX = 240;
  const spacingY = 30;

  const subtreeHeights = new Map<string, number>();

  const getNodeHeight = (node: MindMapNode) => {
    return canvas.calculateNodeSize(node).height;
  };

  const calculateSubtreeHeight = (nodeId: string): number => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return 0;
    
    const nodeChildren = getChildren(nodeId);
    const ownHeight = getNodeHeight(node);
    
    if (nodeChildren.length === 0) {
      subtreeHeights.set(nodeId, ownHeight);
      return ownHeight;
    }
    
    let childrenHeightSum = 0;
    for (const child of nodeChildren) {
      childrenHeightSum += calculateSubtreeHeight(child.id);
    }
    childrenHeightSum += spacingY * (nodeChildren.length - 1);
    
    const height = Math.max(ownHeight, childrenHeightSum);
    subtreeHeights.set(nodeId, height);
    return height;
  };

  for (const child of children) {
    calculateSubtreeHeight(child.id);
  }

  const positionSubtree = (nodeId: string, currentX: number, centerY: number, side: number) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    
    outPositions.set(nodeId, { x: currentX, y: centerY });
    
    const nodeChildren = getChildren(nodeId);
    if (nodeChildren.length === 0) return;
    
    let totalChildrenHeight = 0;
    for (const child of nodeChildren) {
      totalChildrenHeight += subtreeHeights.get(child.id) || 0;
    }
    totalChildrenHeight += spacingY * (nodeChildren.length - 1);
    
    let yCursor = centerY - totalChildrenHeight / 2;
    for (const child of nodeChildren) {
      const childHeight = subtreeHeights.get(child.id) || 0;
      const childCenterY = yCursor + childHeight / 2;
      positionSubtree(child.id, currentX + side * spacingX, childCenterY, side);
      yCursor += childHeight + spacingY;
    }
  };

  if (rightChildren.length > 0) {
     let totalRightHeight = 0;
     for (const child of rightChildren) {
       totalRightHeight += subtreeHeights.get(child.id) || 0;
     }
     totalRightHeight += spacingY * (rightChildren.length - 1);
     
     let yCursor = rootNode.position.y - totalRightHeight / 2;
     for (const child of rightChildren) {
       const childHeight = subtreeHeights.get(child.id) || 0;
       const childCenterY = yCursor + childHeight / 2;
       positionSubtree(child.id, rootNode.position.x + spacingX, childCenterY, 1);
       yCursor += childHeight + spacingY;
     }
  }

  if (leftChildren.length > 0) {
     let totalLeftHeight = 0;
     for (const child of leftChildren) {
       totalLeftHeight += subtreeHeights.get(child.id) || 0;
     }
     totalLeftHeight += spacingY * (leftChildren.length - 1);
     
     let yCursor = rootNode.position.y - totalLeftHeight / 2;
     for (const child of leftChildren) {
       const childHeight = subtreeHeights.get(child.id) || 0;
       const childCenterY = yCursor + childHeight / 2;
       positionSubtree(child.id, rootNode.position.x - spacingX, childCenterY, -1);
       yCursor += childHeight + spacingY;
     }
  }
}

async function triggerAutoLayout() {
  if (!currentPageId || !canvasManager || !commandStack || canvasManager['currentPlaybackTime']) return;

  const nodes = canvasManager['nodes'];
  const edges = canvasManager['edges'];
  const rootNode = nodes.find((node) => !edges.some((edge) => edge.target === node.id));
  if (!rootNode) return;

  const newPositions = new Map<string, Position>();
  const nodesCopy = nodes.map((n) => ({ ...n, position: { ...n.position } }));
  runAutoLayout(nodesCopy, edges, rootNode, canvasManager, newPositions);

  await commandStack.execute(
    new AlignNodesCommand(currentPageId, newPositions, async () => {
      await loadAndRenderCanvas();
      await refreshTimeline();
    })
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
  zoomResetBtn = document.getElementById('zoom-reset-btn') as HTMLButtonElement;
  recordingToast = document.getElementById('recording-toast') as HTMLElement;
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
      const isPast = canvasManager?.['currentPlaybackTime'] !== null;
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
        new MoveNodeCommand(nodeId, pos, async () => {
          await loadAndRenderCanvas();
          await refreshTimeline();
        })
      );
    }
  };

  canvasManager.onAddChildNode = async (parentNodeId) => {
    if (!currentPageId || !commandStack || canvasManager?.['currentPlaybackTime']) return;
    
    const parentNode = canvasManager!['nodes'].find((n) => n.id === parentNodeId);
    if (!parentNode) return;

    const nodes = canvasManager!['nodes'];
    const edges = canvasManager!['edges'];
    const isParentRoot = !edges.some((e) => e.target === parentNodeId);
    const children = nodes.filter((n) => edges.some((e) => e.source === parentNodeId && e.target === n.id));

    let side = 1; // 1 = right, -1 = left
    if (isParentRoot) {
      // 親がルートの場合、左右の既存の子ノード数を比較して少ない方に配置する
      const rightChildrenCount = children.filter((c) => c.position.x > parentNode.position.x).length;
      const leftChildrenCount = children.filter((c) => c.position.x < parentNode.position.x).length;
      if (rightChildrenCount > leftChildrenCount) {
        side = -1;
      } else {
        side = 1;
      }
    } else {
      // 親がルート以外の場合、親と同じ側に配置する
      const rootNode = nodes.find((n) => !edges.some((e) => e.target === n.id));
      if (rootNode && parentNode.position.x < rootNode.position.x) {
        side = -1;
      } else {
        side = 1;
      }
    }

    const newX = parentNode.position.x + side * 240;

    // Y座標の決定: 選択した側の既存の子ノードのY座標リストを取得し、重ならないスロットを探索する
    const targetChildren = children.filter((c) => side === 1 ? c.position.x > parentNode.position.x : c.position.x < parentNode.position.x);
    const existingYCoords = targetChildren.map((c) => c.position.y);

    let slot = 0;
    let targetY = parentNode.position.y;
    while (true) {
      let offsetY = 0;
      if (slot > 0) {
        const isOdd = slot % 2 !== 0;
        const step = Math.ceil(slot / 2);
        offsetY = isOdd ? 80 * step : -80 * step;
      }
      targetY = parentNode.position.y + offsetY;
      const hasOverlap = existingYCoords.some((y) => Math.abs(y - targetY) < 40);
      if (!hasOverlap) {
        break;
      }
      slot++;
    }

    const newPos = {
      x: newX,
      y: targetY
    };

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
        async () => {
          await loadAndRenderCanvas();
          await refreshTimeline();
        },
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
    if (!currentPageId || !commandStack || canvasManager?.['currentPlaybackTime']) return;

    // 既にルートノード（親エッジを持たないノード）が存在するかチェック
    const nodes = canvasManager!['nodes'];
    const edges = canvasManager!['edges'];
    const hasRoot = nodes.some((node) => !edges.some((edge) => edge.target === node.id));
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
        async () => {
          await loadAndRenderCanvas();
          await refreshTimeline();
        },
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

  // 4. コンテキストメニューマネージャーの初期化
  contextMenuManager = new ContextMenuManager();
  
  canvasManager.onContextMenu = (nodeId, clientX, clientY) => {
    if (canvasManager?.['currentPlaybackTime']) return;

    contextMenuManager?.show(nodeId, clientX, clientY, {
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
            await loadAndRenderCanvas();
            await refreshTimeline();
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
              new DeleteNodeCommand(id, async () => {
                await loadAndRenderCanvas();
                await refreshTimeline();
                if (sidebarManager) sidebarManager.loadPages(currentPageId);
              })
            );
          }
        }
      }
    });
  };

  // 写真拡大表示用モーダル処理
  const imageModal = document.getElementById('image-modal') as HTMLElement;
  const modalImage = document.getElementById('modal-image') as HTMLImageElement;
  const closeModalBtn = document.getElementById('close-modal-btn') as HTMLButtonElement;
  
  canvasManager['canvas'].addEventListener('click', async (e) => {
    if (!canvasManager) return;
    const rect = canvasManager['canvas'].getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    if (e.target !== canvasManager['canvas'] || document.querySelector('.canvas-textarea') || !contextMenuManager?.['menuEl'].classList.contains('hidden')) {
      return;
    }

    const worldPos = canvasManager['screenToWorld'](mouseX, mouseY);
    const hitNode = canvasManager['findNodeAt'](worldPos);

    if (hitNode && hitNode.media.hasImage && hitNode.media.imageRef) {
      if (hitNode.id === canvasManager['hoveredNodeId'] && canvasManager['isHoveringPlusBtn']) {
        return;
      }

      const size = canvasManager['calculateNodeSize'](hitNode);
      const rx = hitNode.position.x - size.width / 2;
      const ry = hitNode.position.y - size.height / 2;

      const paddingX = canvasManager['NODE_PADDING_X'];
      const paddingY = canvasManager['NODE_PADDING_Y'];
      
      const img = canvasManager['imageCache'].get(hitNode.media.imageRef);
      if (img && img.complete) {
        const imgWidth = size.width - paddingX * 2;
        const imgHeight = (img.height / img.width) * imgWidth;

        const imgXMin = rx + paddingX;
        const imgXMax = rx + paddingX + imgWidth;
        const imgYMin = ry + paddingY;
        const imgYMax = ry + paddingY + imgHeight;

        if (
          worldPos.x >= imgXMin &&
          worldPos.x <= imgXMax &&
          worldPos.y >= imgYMin &&
          worldPos.y <= imgYMax
        ) {
          let displaySrc = hitNode.media.imageRef;
          
          const dbImageKey = `img-${hitNode.id}`;
          const dbBlob = await db.getImage(dbImageKey);
          if (dbBlob) {
            displaySrc = URL.createObjectURL(dbBlob);
          }

          modalImage.src = displaySrc;
          imageModal.classList.remove('hidden');
        }
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
        if (commandStack && commandStack.canUndo() && !canvasManager?.['currentPlaybackTime']) {
          commandStack.undo();
        }
      },
      onRedo: () => {
        if (commandStack && commandStack.canRedo() && !canvasManager?.['currentPlaybackTime']) {
          commandStack.redo();
        }
      },
      onAddSibling: async (nodeId) => {
        if (!currentPageId || !commandStack || canvasManager?.['currentPlaybackTime']) return;
        
        const edges = await db.getEdgesByPage(currentPageId);
        const parentEdge = edges.find((e) => e.target === nodeId);
        const parentId = parentEdge ? parentEdge.source : null;

        if (parentId === null) {
          // ルートノードの兄弟ノード（新たなルート）は作成できない
          return;
        }

        const node = canvasManager!['nodes'].find((n) => n.id === nodeId);
        if (!node) return;

        const newPos = {
          x: node.position.x,
          y: node.position.y + 80
        };

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
            async () => {
              await loadAndRenderCanvas();
              await refreshTimeline();
            },
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
        if (canvasManager?.['currentPlaybackTime']) return;
        if (confirm('このノードとすべての子ノードを削除しますか？')) {
          if (commandStack && currentPageId) {
            await commandStack.execute(
              new DeleteNodeCommand(nodeId, async () => {
                await loadAndRenderCanvas();
                await refreshTimeline();
                if (sidebarManager) sidebarManager.loadPages(currentPageId);
              })
            );
          }
        }
      },
      onEditText: (nodeId) => {
        startInlineEdit(nodeId);
      },
      onAlign: () => {
        triggerAutoLayout();
      }
    }
  );

  alignBtn.addEventListener('click', () => {
    triggerAutoLayout();
  });

  // 6. タイムライン再生の初期化
  playbackManager = new PlaybackManager(canvasManager);
  
  playbackManager.onTimeChanged = (timeIso) => {
    const isPast = timeIso !== null;
    
    undoBtn.disabled = isPast || (commandStack ? !commandStack.canUndo() : true);
    redoBtn.disabled = isPast || (commandStack ? !commandStack.canRedo() : true);
    alignBtn.disabled = isPast;
    currentPageTitleInput.disabled = isPast;
    
    const newPageBtn = document.getElementById('new-page-btn') as HTMLButtonElement;
    if (newPageBtn) newPageBtn.disabled = isPast;

    if (isPast) {
      removeInlineTextarea();
      contextMenuManager?.hide();
      stopSpeechRecognition();
    }
  };

  // 7. Google Drive同期マネージャーの初期化
  syncManager = new GoogleDriveSyncManager();

  syncManager.onStatusChanged = async (status, msg) => {
    console.log(`Sync status: ${status} (${msg || ''})`);
    
    // UI の更新
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

          // 同期が成功した場合、メモリ側＆描画を最新データにリフレッシュする
          if (msg === '同期が成功しました') {
            const pages = await db.getAllPages();
            if (pages.length > 0) {
              // 現在選択中のページが同期後も残っていればそれを維持、なければ最前面のページを表示
              const hasCurrent = pages.some((p) => p.pageId === currentPageId);
              const targetPageId = hasCurrent ? currentPageId! : pages[0].pageId;
              
              if (sidebarManager) {
                await sidebarManager.loadPages(targetPageId);
              }
              await selectPage(targetPageId);
            }
          }
          break;
      }
    }
  };

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

  // 同期マネージャーの初期化を実行 (アプリ起動をブロックしないよう非同期で実行)
  console.log('Initializing sync manager...');
  syncManager.initialize().then((success) => {
    console.log('Sync manager initialization finished. Success:', success);
  }).catch((err) => {
    console.error('Sync manager initialization failed with error:', err);
  });

  // 8. サイドバーマネージャー初期化
  console.log('Initializing sidebar manager...');
  sidebarManager = new SidebarManager(
    selectPage,
    handlePageDeleted,
    handlePageCreated
  );

  // 初回ページロード
  const pages = await db.getAllPages();
  if (pages.length > 0) {
    await selectPage(pages[0].pageId);
    await sidebarManager.loadPages(pages[0].pageId);
  } else {
    const newPage = await db.createPage('ようこそノート');
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
    await selectPage(newPage.pageId);
    await sidebarManager.loadPages(newPage.pageId);
  }
});
