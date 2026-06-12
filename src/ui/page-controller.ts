import { CommandStack, UpdatePageTitleCommand, AlignNodesCommand } from '../history';
import { MindMapCanvas } from '../canvas';
import { Position } from '../types';
import { store } from '../app/store';
import { findRootNode } from '../domain/graph';
import { runAutoLayout } from '../domain/layout';

export class PageController {
  constructor(
    private commandStack: CommandStack,
    private titleInput: HTMLInputElement
  ) {}

  public initEvents() {
    this.titleInput.addEventListener('blur', () => this.commitPageTitle());
    this.titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.titleInput.blur();
      }
    });
  }

  public async commitPageTitle() {
    const pageId = store.getState().currentPageId;
    if (!pageId) return;

    const newTitle = this.titleInput.value.trim() || '無題のノート';
    this.titleInput.value = newTitle;

    const page = store.getState().pages.find(p => p.pageId === pageId);
    if (page && page.title === newTitle) {
      return; // 変更なし
    }

    await this.commandStack.execute(
      new UpdatePageTitleCommand(pageId, newTitle)
    );
  }

  public async triggerAutoLayout(canvasManager: MindMapCanvas) {
    const pageId = store.getState().currentPageId;
    if (!pageId || canvasManager.isInPlaybackMode()) return;

    const nodes = [...canvasManager.getNodes()];
    const edges = [...canvasManager.getEdges()];
    const rootNode = findRootNode(nodes, edges);
    if (!rootNode) return;

    const newPositions = new Map<string, Position>();
    const nodesCopy = nodes.map((n) => ({ ...n, position: { ...n.position } }));
    runAutoLayout(nodesCopy, edges, rootNode, newPositions);

    await this.commandStack.execute(
      new AlignNodesCommand(pageId, newPositions)
    );
  }
}
