import { getAllDataForSync, restoreAllDataFromSync } from './data/database';

export class GoogleDriveSyncManager {
  // OAuth2 設定 (Viteの環境変数からロード)
  private readonly CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  private readonly SCOPES = 'https://www.googleapis.com/auth/drive.appdata';
  private readonly BACKUP_FILE_NAME = 'chronomap_backup.json';

  private accessToken: string | null = null;
  private tokenClient: any = null;

  // コールバック
  public onStatusChanged: ((status: 'idle' | 'syncing' | 'authenticated' | 'error' | 'offline', msg?: string) => void) | null = null;

  constructor() {
    this.initNetworkMonitoring();
  }

  // Google APIs SDK を動的ロードして初期化
  public async initialize(): Promise<boolean> {
    console.log('sync.ts: initialize started. CLIENT_ID:', this.CLIENT_ID);
    if (!this.CLIENT_ID) {
      console.warn('sync.ts: Google Client ID is not configured.');
      this.updateStatus('error', 'Google クライアントIDが未設定です');
      return false;
    }

    if (!navigator.onLine) {
      this.updateStatus('offline', 'ネットワークがオフラインです');
      return false;
    }

    try {
      this.updateStatus('idle', 'Google 認証ライブラリをロード中...');
      console.log('sync.ts: Loading Google GIS SDK script...');
      await this.loadScript('https://accounts.google.com/gsi/client');
      console.log('sync.ts: Google GIS SDK script loaded successfully.');
      
      // GIS Token Client の初期化
      const google = (window as any).google;
      if (google?.accounts?.oauth2) {
        console.log('sync.ts: Initializing Token Client...');
        this.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: this.CLIENT_ID,
          scope: this.SCOPES,
          callback: (response: any) => {
            console.log('sync.ts: Auth callback received response:', response);
            if (response.error) {
              console.error('GIS authentication error:', response);
              this.updateStatus('error', 'Google 認証に失敗しました');
              return;
            }
            this.accessToken = response.access_token;
            this.updateStatus('authenticated', 'Google 認証に成功しました');
            // 認証成功時に自動で同期を走らせる
            this.sync();
          },
        });
        console.log('sync.ts: Token Client initialized.');
        this.updateStatus('idle', '同期の準備が完了しました');
        return true;
      }
      console.warn('sync.ts: google.accounts.oauth2 is not available.');
      return false;
    } catch (err) {
      console.error('Failed to load Google GIS SDK:', err);
      this.updateStatus('error', 'Google SDKのロードに失敗しました');
      return false;
    }
  }

  // 認証の開始
  public login() {
    if (!navigator.onLine) {
      this.updateStatus('offline', 'オフライン時はログインできません');
      return;
    }
    
    if (this.tokenClient) {
      // 既にアクセストークンがある場合は期限切れを考慮して再取得
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      this.updateStatus('error', '認証ライブラリが初期化されていません');
    }
  }

  // ログイン状態かチェック
  public isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  // 同期処理実行
  public async sync() {
    if (!this.accessToken) {
      this.login();
      return;
    }

    if (!navigator.onLine) {
      this.updateStatus('offline', 'オフラインのため同期できません');
      return;
    }

    try {
      this.updateStatus('syncing', 'クラウドデータを取得中...');

      // 1. Google Drive 上の appDataFolder からバックアップファイルを検索
      const fileId = await this.findBackupFile();
      
      let cloudData: any = null;
      if (fileId) {
        this.updateStatus('syncing', 'クラウドデータをダウンロード中...');
        cloudData = await this.downloadFile(fileId);
      }

      // 2. ローカルデータの収集 (画像を Base64 にエンコードして JSON に含める)
      this.updateStatus('syncing', 'ローカルデータを収集中...');
      const localData = await this.collectLocalData();

      // 3. クラウドデータとローカルデータのマージ (競合解消)
      this.updateStatus('syncing', 'データをマージ中...');
      const mergedData = await this.mergeData(localData, cloudData);

      // 4. マージされたデータをローカル IndexedDB に書き戻す
      this.updateStatus('syncing', 'ローカルデータベースに書き込み中...');
      await this.restoreLocalData(mergedData);

      // 5. 最新のマージデータを Google Drive にアップロード
      this.updateStatus('syncing', 'クラウドへバックアップを送信中...');
      await this.uploadFile(fileId, mergedData);

      this.updateStatus('idle', '同期が成功しました');
    } catch (err: any) {
      console.error('Sync process failed:', err);
      this.updateStatus('error', `同期に失敗しました: ${err.message || err}`);
    }
  }

  // Google Drive の appDataFolder 内のファイルを検索
  private async findBackupFile(): Promise<string | null> {
    const url = 'https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name="' + this.BACKUP_FILE_NAME + '" and trashed=false';
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to query files: ${response.statusText}`);
    }

    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
  }

  // ファイルダウンロード
  private async downloadFile(fileId: string): Promise<any> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download backup: ${response.statusText}`);
    }

    return response.json();
  }

  // ファイルアップロード (新規作成 or 上書き)
  private async uploadFile(fileId: string | null, data: any): Promise<void> {
    const boundary = 'foo_bar_baz';
    const metadata = {
      name: this.BACKUP_FILE_NAME,
      mimeType: 'application/json',
      parents: fileId ? undefined : ['appDataFolder'],
    };

    const multipartRequestBody =
      `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
      JSON.stringify(data) +
      `\r\n--${boundary}--`;

    let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    let method = 'POST';

    if (fileId) {
      // 上書き更新
      url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
      method = 'PATCH';
    }

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }
  }

  // ローカルデータを収集し、画像を Base64 化したオブジェクトを生成
  private async collectLocalData() {
    return getAllDataForSync();
  }

  // ローカル IndexedDB にマージ後データを書き込む
  private async restoreLocalData(data: any) {
    await restoreAllDataFromSync(data);
  }

  // 競合解消マージ処理 (updatedAt が新しい方を採用)
  private async mergeData(local: any, cloud: any) {
    if (!cloud) {
      // クラウドデータが無い場合でも、ローカルデータから孤立した画像を削除して返却する
      const activeImageRefs = new Set(
        local.nodes
          .filter((n: any) => !n.deleted && n.media.hasImage && n.media.imageRef)
          .map((n: any) => n.media.imageRef)
      );
      local.images = local.images.filter((img: any) => activeImageRefs.has(img.id));
      return local;
    }

    const merged = {
      pages: this.mergeEntities(local.pages, cloud.pages, 'pageId'),
      nodes: this.mergeEntities(local.nodes, cloud.nodes, 'id'),
      edges: this.mergeEntities(local.edges, cloud.edges, 'id', true), // エッジも updatedAt 比較でマージ
      history: this.mergeEntities(local.history, cloud.history, 'entryId', false), // 履歴は entryId でマージ
      images: this.mergeImages(local.images, cloud.images),
    };

    // 画像データのガーベジコレクション (アクティブなノードから参照されていない画像を排除)
    const activeImageRefs = new Set(
      merged.nodes
        .filter((n: any) => !n.deleted && n.media.hasImage && n.media.imageRef)
        .map((n: any) => n.media.imageRef)
    );
    merged.images = merged.images.filter((img: any) => activeImageRefs.has(img.id));

    return merged;
  }

  // 汎用エンティティマージ (updatedAt 比較)
  private mergeEntities(localList: any[], cloudList: any[], idKey: string, useUpdatedAt = true): any[] {
    const map = new Map<string, any>();
    
    // まずローカルデータを格納
    for (const item of localList) {
      map.set(item[idKey], item);
    }

    // クラウドデータと比較しながらマージ
    for (const cloudItem of cloudList) {
      const id = cloudItem[idKey];
      const localItem = map.get(id);

      if (!localItem) {
        // クラウドにしか存在しない場合は追加
        map.set(id, cloudItem);
      } else if (useUpdatedAt) {
        // 両方にある場合は updatedAt を比較
        const localTime = new Date(localItem.updatedAt || localItem.createdAt || 0).getTime();
        const cloudTime = new Date(cloudItem.updatedAt || cloudItem.createdAt || 0).getTime();
        
        if (cloudTime > localTime) {
          map.set(id, cloudItem);
        }
      }
    }

    return Array.from(map.values());
  }

  // 画像ストアのマージ
  private mergeImages(localImages: any[], cloudImages: any[]): any[] {
    const map = new Map<string, any>();
    
    for (const img of localImages) {
      map.set(img.id, img);
    }
    
    // クラウド側画像で上書き/マージ (ノードの updatedAt マージが正常に行われるため画像自体は重複のない方を優先して取り込む)
    for (const cloudImg of cloudImages) {
      if (!map.has(cloudImg.id)) {
        map.set(cloudImg.id, cloudImg);
      }
    }

    return Array.from(map.values());
  }

  // ==========================================
  // ユーティリティ
  // ==========================================



  // 動的スクリプト読み込み
  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Script load failed: ${src}`));
      document.head.appendChild(script);
    });
  }

  // 同期ステータス通知
  private updateStatus(status: 'idle' | 'syncing' | 'authenticated' | 'error' | 'offline', msg?: string) {
    if (this.onStatusChanged) {
      this.onStatusChanged(status, msg);
    }
  }

  // ネットワーク接続状態の監視
  private initNetworkMonitoring() {
    window.addEventListener('online', () => {
      this.updateStatus('idle', 'オンラインに戻りました');
    });
    window.addEventListener('offline', () => {
      this.updateStatus('offline', 'ネットワークがオフラインです');
    });
  }
}
