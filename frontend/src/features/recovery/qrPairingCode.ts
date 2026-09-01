import QRCode from "qrcode";
import jsQR from "jsqr";

export async function renderPairingQrCode(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 256 });
}

export interface QrScanner {
  stop(): void;
}

/** Scans camera frames for a QR code until one decodes or `stop()` is called. */
export function scanPairingQrCode(video: HTMLVideoElement, onDecoded: (text: string) => void, onError: (error: Error) => void): QrScanner {
  let stopped = false;
  let stream: MediaStream | null = null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

  const tick = (): void => {
    if (stopped) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA && context) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(frame.data, frame.width, frame.height);
      if (code?.data) {
        stop();
        onDecoded(code.data);
        return;
      }
    }
    requestAnimationFrame(tick);
  };

  const stop = (): void => {
    stopped = true;
    stream?.getTracks().forEach((track) => track.stop());
  };

  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then((mediaStream) => {
      if (stopped) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = mediaStream;
      video.srcObject = mediaStream;
      void video.play();
      requestAnimationFrame(tick);
    })
    .catch((error: unknown) => onError(error instanceof Error ? error : new Error("カメラを使えませんでした")));

  return { stop };
}
