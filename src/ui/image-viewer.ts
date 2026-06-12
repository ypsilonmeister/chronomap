import { MindMapCanvas } from '../canvas';
import { RadialMenuManager } from '../radial-menu';
import * as imageRepo from '../data/image-repo';

export class ImageViewerController {
  constructor(
    private canvasManager: MindMapCanvas,
    private radialMenuManager: RadialMenuManager,
    private imageModal: HTMLElement,
    private modalImage: HTMLImageElement,
    private closeModalBtn: HTMLButtonElement
  ) {}

  public initEvents() {
    this.canvasManager.getCanvasElement().addEventListener('click', async (e) => {
      const rect = this.canvasManager.getCanvasElement().getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      if (
        e.target !== this.canvasManager.getCanvasElement() ||
        document.querySelector('.canvas-textarea') ||
        this.radialMenuManager.isVisible()
      ) {
        return;
      }

      const worldPos = this.canvasManager.screenToWorld(mouseX, mouseY);
      const hitNode = this.canvasManager.findNodeAt(worldPos);

      if (hitNode && hitNode.media.hasImage && hitNode.media.imageRef) {
        if (this.canvasManager.isPositionOnPlusButton(hitNode.id, worldPos)) {
          return;
        }

        if (this.canvasManager.isPositionOnNodeImage(hitNode.id, worldPos)) {
          let displaySrc = hitNode.media.imageRef;
          
          const dbImageKey = `img-${hitNode.id}`;
          const dbBlob = await imageRepo.getImage(dbImageKey);
          if (dbBlob) {
            displaySrc = URL.createObjectURL(dbBlob);
          }

          this.modalImage.src = displaySrc;
          this.imageModal.classList.remove('hidden');
        }
      }
    });

    this.closeModalBtn.addEventListener('click', () => {
      this.imageModal.classList.add('hidden');
    });

    this.imageModal.querySelector('.modal-backdrop')?.addEventListener('click', () => {
      this.imageModal.classList.add('hidden');
    });
  }
}
