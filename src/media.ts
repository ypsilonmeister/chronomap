import * as nodeRepo from './data/node-repo';
import * as imageRepo from './data/image-repo';
import * as eventlogRepo from './data/eventlog-repo';

export class MediaManager {
  // 画像リサイズ＆圧縮
  public static resizeAndCompressImage(file: File, maxWidth = 1024): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const img = new Image();
        
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // リサイズ計算
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas 2D context could not be initialized for resizing.'));
            return;
          }

          // 描画
          ctx.drawImage(img, 0, 0, width, height);

          // Blob に変換 (画質 0.82 程度の WebP、フォールバックとして JPEG)
          const format = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Canvas conversion to Blob failed.'));
              }
            },
            format,
            0.82
          );
        };

        img.onerror = () => {
          reject(new Error('Failed to load image for resizing.'));
        };

        img.src = e.target?.result as string;
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file.'));
      };

      reader.readAsDataURL(file);
    });
  }

  // デバイスの画像選択ダイアログを開き、画像をIndexedDBに保存し、ノードを更新する
  public static async attachImageToNode(
    nodeId: string,
    onSuccess: (imageRef: string) => void,
    onError: (err: any) => void
  ) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // モバイル端末でカメラ起動に対応
    input.setAttribute('capture', 'environment');

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        // 画像をリサイズ
        const compressedBlob = await this.resizeAndCompressImage(file);
        
        // 画像キーの作成
        const imageRef = `img-${nodeId}`;
        
        // IndexedDBに画像を保存
        await imageRepo.saveImage(imageRef, compressedBlob);
        
        // ローカルBlob URLの生成 (表示高速化用)
        const localBlobUrl = URL.createObjectURL(compressedBlob);

        // 既存ノードの音声メタデータを保持するために現在のノード情報を取得
        const existingNode = await nodeRepo.getNode(nodeId);
        const existingMedia = existingNode?.media;

        // ノード情報を更新（永久IDである `img-nodeId` を保存する）
        await nodeRepo.updateNode(nodeId, {
          media: {
            hasImage: true,
            imageRef: imageRef, // 保存するのは永久参照キー（img-nodeId）
            hasAudio: existingMedia?.hasAudio ?? false,
            audioRef: existingMedia?.audioRef ?? ''
          }
        });

        // タイムライン履歴の記録
        if (existingNode) {
          await eventlogRepo.addHistory({
            pageId: existingNode.pageId,
            timestamp: new Date().toISOString(),
            action: 'update_node',
            payload: {
              nodeId,
              media: {
                hasImage: true,
                imageRef
              }
            }
          });
        }

        onSuccess(localBlobUrl);
      } catch (err) {
        console.error('Failed to attach image:', err);
        onError(err);
      }
    };

    input.click();
  }

  // IndexedDB から画像を取得し、ローカルの Blob URL を生成する
  public static async loadAndCreateImageURL(imageRef: string): Promise<string | null> {
    if (!imageRef.startsWith('img-')) {
      // 既に有効なHTTP(S)URLなどの場合はそのまま返す
      return imageRef;
    }

    try {
      const blob = await imageRepo.getImage(imageRef);
      if (blob) {
        return URL.createObjectURL(blob);
      }
    } catch (err) {
      console.error(`Failed to load image from DB: ${imageRef}`, err);
    }
    return null;
  }
}
