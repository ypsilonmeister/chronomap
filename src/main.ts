import { createIcons, Plus, Search, CloudLightning, Menu, Undo2, Redo2, Sparkles, HelpCircle, Play, Pause, Edit3, Mic, Image, Trash2, X, Download, Upload, FileText, FileCode } from 'lucide';
import { MindMapNode } from './types';
import { MindMapCanvas } from './canvas';
import { CommandStack, AddNodeCommand, MoveNodeCommand, DeleteNodeCommand } from './history';
import { ShortcutManager } from './shortcuts';
import { SidebarManager } from './sidebar';
import { MediaManager } from './media';
import { RadialMenuManager } from './radial-menu';
import { PlaybackManager } from './playback';
import { GoogleDriveSyncManager } from './sync';
import { store } from './app/store';
import { isRootNode } from './domain/graph';
import { calculateChildNodePosition, calculateSiblingNodePosition } from './domain/node-placement';

// Controllers
import { NodeEditorController } from './ui/node-editor';
import { PageController } from './ui/page-controller';
import { SyncController } from './ui/sync-controller';
import { ImageViewerController } from './ui/image-viewer';
import { ExportImportController } from './ui/export-import-controller';

function initIcons() {
  createIcons({
    icons: { Plus, Search, CloudLightning, Menu, Undo2, Redo2, Sparkles, HelpCircle, Play, Pause, Edit3, Mic, Image, Trash2, X, Download, Upload, FileText, FileCode }
  });
}


document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements Cache
  const undoBtn = document.getElementById('undo-btn') as HTMLButtonElement;
  const redoBtn = document.getElementById('redo-btn') as HTMLButtonElement;
  const alignBtn = document.getElementById('align-btn') as HTMLButtonElement;
  const currentPageTitleInput = document.getElementById('current-page-title') as HTMLInputElement;
  const zoomLevelSpan = document.getElementById('zoom-level') as HTMLSpanElement;
  const zoomFitBtn = document.getElementById('zoom-fit-btn') as HTMLButtonElement;
  const zoomResetBtn = document.getElementById('zoom-reset-btn') as HTMLButtonElement;
  const recordingToast = document.getElementById('recording-toast') as HTMLDivElement;
  const stopRecordingBtn = document.getElementById('stop-recording-btn') as HTMLButtonElement;
  const syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;
  const syncStatusText = document.getElementById('sync-status-text') as HTMLSpanElement;

  initIcons();

  // Canvas
  const canvasManager = new MindMapCanvas('mindmap-canvas');
  canvasManager.resize();
  window.addEventListener('resize', () => canvasManager.resize());

  // Undo/Redo
  const commandStack = new CommandStack(() => {
    const isPast = canvasManager.isInPlaybackMode();
    undoBtn.disabled = isPast || !commandStack.canUndo();
    redoBtn.disabled = isPast || !commandStack.canRedo();
  });

  // Managers
  const shortcutManager = new ShortcutManager(
    () => canvasManager.getSelectedNodeId(),
    {
      onUndo: () => { if (commandStack.canUndo() && !canvasManager.isInPlaybackMode()) commandStack.undo(); },
      onRedo: () => { if (commandStack.canRedo() && !canvasManager.isInPlaybackMode()) commandStack.redo(); },
      onAddSibling: async (nodeId) => {
        const pageId = store.getState().currentPageId;
        if (!pageId || canvasManager.isInPlaybackMode()) return;
        const edges = store.getState().edges;
        const parentEdge = edges.find((e) => e.target === nodeId);
        const parentId = parentEdge ? parentEdge.source : null;
        if (parentId === null) return;
        const nodes = [...canvasManager.getNodes()];
        const newPos = calculateSiblingNodePosition(nodeId, nodes);
        if (!newPos) return;
        const createdOut = { node: null as MindMapNode | null };
        await commandStack.execute(new AddNodeCommand({ pageId, text: '新規ノード', media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' }, position: newPos }, parentId, createdOut));
        if (createdOut.node) {
          setTimeout(() => {
            if (createdOut.node) {
              if (window.innerWidth > 768) nodeEditor.startInlineEdit(createdOut.node.id);
              else canvasManager.setSelectedNodeId(createdOut.node.id);
            }
          }, 100);
        }
      },
      onAddChild: (nodeId) => { canvasManager.onAddChildNode?.(nodeId); },
      onDeleteNode: async (nodeId) => {
        const pageId = store.getState().currentPageId;
        if (canvasManager.isInPlaybackMode() || !pageId) return;
        if (confirm('このノードとすべての子ノードを削除しますか？')) await commandStack.execute(new DeleteNodeCommand(nodeId));
      },
      onEditText: (nodeId) => nodeEditor.startInlineEdit(nodeId),
      onAlign: () => pageController.triggerAutoLayout(canvasManager),
      onZoomFit: () => canvasManager.fitToScreen()
    }
  );

  const radialMenuManager = new RadialMenuManager();
  const playbackManager = new PlaybackManager();
  const syncManager = new GoogleDriveSyncManager();
  new SidebarManager(); // SidebarManager handles its own store subscriptions

  // Controllers
  const nodeEditor = new NodeEditorController(canvasManager, commandStack, shortcutManager, recordingToast);
  const pageController = new PageController(commandStack, currentPageTitleInput);
  const syncController = new SyncController(syncManager, syncBtn, syncStatusText);
  const imageViewer = new ImageViewerController(canvasManager, radialMenuManager, document.getElementById('image-modal')!, document.getElementById('modal-image')! as HTMLImageElement, document.getElementById('close-modal-btn')! as HTMLButtonElement);
  const exportImportController = new ExportImportController(canvasManager);

  pageController.initEvents();
  syncController.initEvents();
  imageViewer.initEvents();
  exportImportController.initEvents();


  // Sidebar toggling & Help modals (Miscellaneous UI)
  const sidebar = document.getElementById('sidebar');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  if (sidebar && sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', () => {
      if (window.innerWidth <= 768) sidebar.classList.toggle('show');
      else sidebar.classList.toggle('hidden');
      setTimeout(() => canvasManager.resize(), 300);
    });
    const closeSidebar = (e: Event) => {
      if (window.innerWidth <= 768 && sidebar.classList.contains('show')) {
        const target = e.target as HTMLElement;
        if (!sidebar.contains(target) && !sidebarToggleBtn.contains(target)) sidebar.classList.remove('show');
      }
    };
    document.addEventListener('touchstart', closeSidebar, { passive: true });
    document.addEventListener('mousedown', closeSidebar);
  }

  const helpBtn = document.getElementById('help-btn');
  const helpModal = document.getElementById('help-modal');
  const closeHelpBtn = document.getElementById('close-help-btn');
  if (helpBtn && helpModal && closeHelpBtn) {
    helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'));
    closeHelpBtn.addEventListener('click', () => helpModal.classList.add('hidden'));
    helpModal.querySelector('.modal-backdrop')?.addEventListener('click', () => helpModal.classList.add('hidden'));
  }

  zoomFitBtn.addEventListener('click', () => canvasManager.fitToScreen());
  zoomResetBtn.addEventListener('click', () => canvasManager.resetZoom());
  stopRecordingBtn.addEventListener('click', () => nodeEditor.stopSpeechRecognition());
  alignBtn.addEventListener('click', () => pageController.triggerAutoLayout(canvasManager));

  // Canvas callbacks
  canvasManager.onRender = () => nodeEditor.updateTextareaPosition();
  canvasManager.onZoomChanged = (scale) => { zoomLevelSpan.textContent = `${Math.round(scale * 100)}%`; };
  canvasManager.onNodeMoved = async (nodeId, pos) => { await commandStack.execute(new MoveNodeCommand(nodeId, pos)); };
  canvasManager.onAddChildNode = async (parentNodeId) => {
    const pageId = store.getState().currentPageId;
    if (!pageId || canvasManager.isInPlaybackMode()) return;
    const nodes = [...canvasManager.getNodes()];
    const edges = [...canvasManager.getEdges()];
    const newPos = calculateChildNodePosition(parentNodeId, nodes, edges);
    if (!newPos) return;
    const createdOut = { node: null as MindMapNode | null };
    await commandStack.execute(new AddNodeCommand({ pageId, text: '新規ノード', media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' }, position: newPos }, parentNodeId, createdOut));
    if (createdOut.node) {
      setTimeout(() => {
        if (createdOut.node) {
          if (window.innerWidth > 768) nodeEditor.startInlineEdit(createdOut.node.id);
          else canvasManager.setSelectedNodeId(createdOut.node.id);
        }
      }, 100);
    }
  };
  canvasManager.onAddRootNode = async (pos) => {
    const pageId = store.getState().currentPageId;
    if (!pageId || canvasManager.isInPlaybackMode()) return;
    const nodes = canvasManager.getNodes();
    const edges = canvasManager.getEdges();
    if (nodes.some((node) => isRootNode(node.id, edges))) return;
    const createdOut = { node: null as MindMapNode | null };
    await commandStack.execute(new AddNodeCommand({ pageId, text: '新規テーマ', media: { hasImage: false, imageRef: '', hasAudio: false, audioRef: '' }, position: pos }, null, createdOut));
    if (createdOut.node) {
      setTimeout(() => {
        if (createdOut.node) {
          if (window.innerWidth > 768) nodeEditor.startInlineEdit(createdOut.node.id);
          else canvasManager.setSelectedNodeId(createdOut.node.id);
        }
      }, 100);
    }
  };
  canvasManager.onContextMenu = (nodeId, clientX, clientY) => {
    if (canvasManager.isInPlaybackMode()) return;
    radialMenuManager.show(nodeId, clientX, clientY, {
      onEditText: (id) => nodeEditor.startInlineEdit(id),
      onAudioInput: (id) => nodeEditor.startSpeechRecognition(id),
      onAttachImage: async (id) => {
        await MediaManager.attachImageToNode(id, async () => {
          canvasManager.clearImageCache();
          const pageId = store.getState().currentPageId;
          if (pageId) await store.reloadPageData(pageId);
        }, (err) => alert(`写真の添付に失敗しました: ${err.message || err}`));
      },
      onDeleteNode: async (id) => {
        if (confirm('このノードとすべての子ノードを削除しますか？')) await commandStack.execute(new DeleteNodeCommand(id));
      }
    });
  };
  canvasManager.onRadialSwipe = (clientX, clientY) => radialMenuManager.updateHighlight(clientX, clientY);
  canvasManager.onRadialRelease = () => radialMenuManager.executeActiveAction();

  // Store Subscribe
  let lastCurrentPageId: string | null = null;
  let lastTimelinePageId: string | null = null;
  let lastTimelineNodeCount = 0;
  let lastSyncStatus: string | null = null;

  store.subscribe(async (state) => {
    const pageId = state.currentPageId;
    const isPast = state.playbackTime !== null;
    const titleVal = currentPageTitleInput.value;

    // Page ID changes
    if (pageId !== lastCurrentPageId) {
      const oldPageId = lastCurrentPageId;
      lastCurrentPageId = pageId;
      if (pageId) {
        const page = state.pages.find(p => p.pageId === pageId);
        if (page && page.title !== titleVal && document.activeElement !== currentPageTitleInput) {
          currentPageTitleInput.value = page.title;
          currentPageTitleInput.disabled = false;
        }
        if (oldPageId !== null) {
          commandStack.clear();
        }
      } else {
        currentPageTitleInput.value = '';
        currentPageTitleInput.disabled = true;
      }
      radialMenuManager.hide();
      nodeEditor.removeInlineTextarea();
      nodeEditor.stopSpeechRecognition();
    }

    // Disabled states
    undoBtn.disabled = isPast || !commandStack.canUndo();
    redoBtn.disabled = isPast || !commandStack.canRedo();
    alignBtn.disabled = isPast;
    currentPageTitleInput.disabled = isPast;
    const newPageBtn = document.getElementById('new-page-btn') as HTMLButtonElement;
    if (newPageBtn) newPageBtn.disabled = isPast;

    if (isPast) {
      nodeEditor.removeInlineTextarea();
      radialMenuManager.hide();
      nodeEditor.stopSpeechRecognition();
    }

    // Playback timeline update
    if (pageId && (pageId !== lastTimelinePageId || state.nodes.length !== lastTimelineNodeCount)) {
      lastTimelinePageId = pageId;
      lastTimelineNodeCount = state.nodes.length;
      const isPlaying = playbackManager.getIsPlaying();
      await playbackManager.initPage(pageId);
      if (isPlaying) playbackManager.play();
    } else if (!pageId && lastTimelinePageId !== null) {
      lastTimelinePageId = null;
      lastTimelineNodeCount = 0;
      await playbackManager.initPage('');
    }

    // Sync status update delegate
    const { status, msg } = state.syncStatus;
    if (status !== lastSyncStatus) {
      lastSyncStatus = status;
      syncController.updateUI(status, msg);
    }
  });

  // Initialization
  console.log('Initializing sync manager...');
  syncManager.initialize().catch((err) => console.error('Sync manager init error:', err));
  console.log('Initializing AppStore...');
  await store.initialize();
});
