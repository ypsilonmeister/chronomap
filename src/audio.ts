// Web Speech API の SpeechRecognition 型定義の拡張
interface IWindow extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

const _window = window as unknown as IWindow;
const SpeechRecognition = _window.SpeechRecognition || _window.webkitSpeechRecognition;

export class AudioSpeechRecognizer {
  private recognition: any = null;
  private isRecording = false;

  // コールバック
  public onResult: ((text: string, isFinal: boolean) => void) | null = null;
  public onEnd: (() => void) | null = null;
  public onError: ((error: string) => void) | null = null;

  constructor() {
    this.init();
  }

  // 利用可能かチェック
  public static isSupported(): boolean {
    return !!SpeechRecognition;
  }

  private init() {
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition API is not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'ja-JP';
    this.recognition.continuous = true; // 話し続けられるように
    this.recognition.interimResults = true; // 途中結果も取得する

    this.recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      // コールバック呼び出し (現在の確定 + 途中の結合テキスト)
      if (this.onResult) {
        const text = finalTranscript || interimTranscript;
        this.onResult(text, finalTranscript.length > 0);
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (this.onError) {
        this.onError(event.error);
      }
    };

    this.recognition.onend = () => {
      this.isRecording = false;
      if (this.onEnd) {
        this.onEnd();
      }
    };
  }

  // 録音開始
  public start() {
    if (!this.recognition) {
      if (this.onError) {
        this.onError('Speech recognition is not supported in this browser.');
      }
      return;
    }

    if (this.isRecording) return;

    try {
      this.recognition.start();
      this.isRecording = true;
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
    }
  }

  // 録音停止
  public stop() {
    if (!this.recognition || !this.isRecording) return;
    
    try {
      this.recognition.stop();
      this.isRecording = false;
    } catch (err) {
      console.error('Failed to stop speech recognition:', err);
    }
  }
}
