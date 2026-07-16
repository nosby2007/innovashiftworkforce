import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { FunctionsClient } from '../functions/functions.client';
import { ToastService } from '../ui/toast.service';

// Generated in Firebase Console → Project settings → Cloud Messaging → Web
// Push certificates. Left blank until that manual step is done, at which
// point web push registration activates automatically — no code change.
const VAPID_KEY = 'CxNz74-PUnam0UDcQW_YnCPfZgqVrza3EVGFqY1Eb4w';

@Injectable({ providedIn: 'root' })
export class PushNotificationsService {
  private foregroundListenersBound = false;

  constructor(
    private fx: FunctionsClient,
    private toast: ToastService,
    private router: Router
  ) {}

  /** True once the user has granted OS/browser permission for push. */
  isEnabled(): boolean {
    if (Capacitor.isNativePlatform()) return true; // permission is checked lazily on enable()
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  isSupportedPlatform(): boolean {
    if (Capacitor.isNativePlatform()) return true;
    return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
  }

  async enable(): Promise<boolean> {
    return Capacitor.isNativePlatform() ? this.enableNative() : this.enableWeb();
  }

  private async enableWeb(): Promise<boolean> {
    if (!this.isSupportedPlatform()) return false;
    if (!VAPID_KEY) {
      console.warn('[InnovaShift] Push notifications: no VAPID key configured yet — web push is inactive until one is added.');
      return false;
    }
    if (!(await isSupported().catch(() => false))) return false;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    try {
      // Registered at an isolated scope so it doesn't take over Angular's
      // ngsw-worker.js, which controls the app shell/offline cache.
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/firebase-cloud-messaging-push-scope',
      });
      const messaging = getMessaging();
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
      if (!token) return false;

      await this.fx.call('registerPushToken', { token, platform: 'web' });

      if (!this.foregroundListenersBound) {
        this.foregroundListenersBound = true;
        onMessage(messaging, (payload) => {
          const title = payload.notification?.title || payload.data?.['title'] || 'InnovaShift';
          const body = payload.notification?.body || payload.data?.['body'] || '';
          this.toast.info(body ? `${title} — ${body}` : title);
        });
      }
      return true;
    } catch (err) {
      console.warn('[InnovaShift] Web push registration failed.', err);
      return false;
    }
  }

  private async enableNative(): Promise<boolean> {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    const current = await PushNotifications.checkPermissions();
    let granted = current.receive === 'granted';
    if (!granted) {
      const requested = await PushNotifications.requestPermissions();
      granted = requested.receive === 'granted';
    }
    if (!granted) return false;

    if (!this.foregroundListenersBound) {
      this.foregroundListenersBound = true;
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        this.toast.info(notification.body ? `${notification.title ?? 'InnovaShift'} — ${notification.body}` : (notification.title ?? 'InnovaShift'));
      });
      // Native OS notifications don't support the web "Accept" inline
      // action button yet — tapping opens the app straight to the shift.
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const deepLink = (action.notification?.data as Record<string, string> | undefined)?.['deepLink'];
        if (deepLink) void this.router.navigateByUrl(deepLink);
      });
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      PushNotifications.addListener('registration', async (token) => {
        if (settled) return;
        settled = true;
        try {
          await this.fx.call('registerPushToken', { token: token.value, platform: Capacitor.getPlatform() });
          resolve(true);
        } catch (err) {
          console.warn('[InnovaShift] Failed to register native push token.', err);
          resolve(false);
        }
      });
      PushNotifications.addListener('registrationError', (err) => {
        if (settled) return;
        settled = true;
        console.warn('[InnovaShift] Native push registration error.', err);
        resolve(false);
      });
      void PushNotifications.register();
    });
  }
}
