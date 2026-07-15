import { Injectable } from '@angular/core';
import { Camera, CameraDirection } from '@capacitor/camera';

/**
 * Captures a single document photo with the device (or browser) camera and
 * returns it as a plain File, ready to feed the existing document-upload
 * pipeline unchanged. On native, @capacitor/camera opens the OS camera; on
 * web it opens a live-preview capture modal (via @ionic/pwa-elements,
 * registered in main.ts) and falls back to a file input with the camera
 * capture attribute if that isn't available.
 */
@Injectable({ providedIn: 'root' })
export class DocumentScanService {
  async capture(): Promise<File | null> {
    try {
      const result = await Camera.takePhoto({
        quality: 85,
        cameraDirection: CameraDirection.Rear,
        correctOrientation: true,
        saveToGallery: false,
      });

      const source = result.webPath || result.uri;
      if (!source) return null;

      const response = await fetch(source);
      const blob = await response.blob();
      const format = result.metadata?.format?.replace('jpg', 'jpeg') || 'jpeg';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      return new File([blob], `document-scan-${timestamp}.${format}`, { type: blob.type || `image/${format}` });
    } catch (err) {
      console.warn('[InnovaShift] Document scan capture failed or was cancelled.', err);
      return null;
    }
  }
}
