// Web Speech API (SpeechRecognition) の薄いラッパー。
// 対応ブラウザが無ければ null を返し、呼び出し側でボタンを無効化する。

/**
 * @param {{onResult: (text: string, isFinal: boolean) => void, onStart?: () => void, onEnd?: () => void, onError?: (e: any) => void}} handlers
 * @returns {SpeechRecognition | null}
 */
export function createSpeechRecognizer(handlers) {
  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionImpl) return null;

  const recognition = new SpeechRecognitionImpl();
  recognition.lang = "ja-JP";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => handlers.onStart && handlers.onStart();
  recognition.onend = () => handlers.onEnd && handlers.onEnd();
  recognition.onerror = (event) => handlers.onError && handlers.onError(event);
  recognition.onresult = (event) => {
    let transcript = "";
    let isFinal = false;
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
      if (event.results[i].isFinal) isFinal = true;
    }
    handlers.onResult(transcript, isFinal);
  };

  return recognition;
}

export function isSpeechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}
