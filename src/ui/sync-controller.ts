import { GoogleDriveSyncManager } from '../sync';

export class SyncController {
  constructor(
    private syncManager: GoogleDriveSyncManager,
    private syncBtn: HTMLButtonElement,
    private syncStatusText: HTMLSpanElement
  ) {}

  public initEvents() {
    this.syncBtn.addEventListener('click', () => {
      if (this.syncManager.isAuthenticated()) {
        this.syncManager.sync();
      } else {
        this.syncManager.login();
      }
    });
  }

  public updateUI(status: 'idle' | 'syncing' | 'authenticated' | 'error' | 'offline', msg?: string) {
    console.log(`Sync status in UI controller: ${status} (${msg || ''})`);

    switch (status) {
      case 'syncing':
        this.syncStatusText.textContent = msg || '同期中...';
        this.syncBtn.disabled = true;
        break;
      case 'offline':
        this.syncStatusText.textContent = 'オフライン (同期不可)';
        this.syncBtn.disabled = true;
        break;
      case 'authenticated':
        this.syncStatusText.textContent = '認証成功 (同期開始)';
        this.syncBtn.disabled = true;
        break;
      case 'error':
        this.syncStatusText.textContent = '同期エラー (再接続)';
        this.syncBtn.disabled = false;
        break;
      case 'idle':
      default:
        this.syncStatusText.textContent = 'Google Drive 同期';
        this.syncBtn.disabled = false;
        break;
    }
  }
}
