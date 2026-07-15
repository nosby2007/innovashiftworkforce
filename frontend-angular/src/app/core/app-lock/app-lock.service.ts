import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { bufferToBase64Url, base64UrlToBuffer } from '../../shared/utils/webauthn.util';

const WEBAUTHN_RP_NAME = 'InnovaShift Workforce';

/**
 * App-lock gate: biometrics protect access to the Firebase Auth session
 * that's already persisted on this device — they do not replace the
 * original password sign-in and nothing biometric-specific is verified
 * server-side. Native (Android/iOS) uses the OS biometric prompt via
 * @aparajita/capacitor-biometric-auth; web uses a platform WebAuthn
 * authenticator (Windows Hello / Touch ID) purely as a local unlock check.
 */
@Injectable({ providedIn: 'root' })
export class AppLockService {
  readonly locked = signal(false);

  private armedUid: string | null = null;
  private resumeListenerBound = false;

  constructor() {
    if (Capacitor.isNativePlatform() && !this.resumeListenerBound) {
      this.resumeListenerBound = true;
      void App.addListener('appStateChange', ({ isActive }) => {
        if (isActive && this.armedUid) {
          void this.armIfEnabled(this.armedUid);
        }
      });
    }
  }

  private prefKey(uid: string): string {
    return `applock:enabled:${uid}`;
  }

  private webAuthnKey(uid: string): string {
    return `applock:webauthn:${uid}`;
  }

  async isAvailable(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      try {
        const result = await BiometricAuth.checkBiometry();
        return result.isAvailable;
      } catch {
        return false;
      }
    }
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  async isEnabled(uid: string): Promise<boolean> {
    if (!uid) return false;
    if (Capacitor.isNativePlatform()) {
      const { value } = await Preferences.get({ key: this.prefKey(uid) });
      return value === 'true';
    }
    return typeof localStorage !== 'undefined' && !!localStorage.getItem(this.webAuthnKey(uid));
  }

  /** Prompts for biometric consent once, then persists the preference. */
  async enable(uid: string, label: string): Promise<boolean> {
    if (!uid) return false;

    if (Capacitor.isNativePlatform()) {
      try {
        await BiometricAuth.authenticate({
          reason: 'Confirm to enable Face ID / Fingerprint unlock',
          allowDeviceCredential: false,
          cancelTitle: 'Cancel',
        });
      } catch {
        return false;
      }
      await Preferences.set({ key: this.prefKey(uid), value: 'true' });
      return true;
    }

    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: WEBAUTHN_RP_NAME },
          user: { id: userId, name: label || 'InnovaShift user', displayName: label || 'InnovaShift user' },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
          attestation: 'none',
          timeout: 60000,
        },
      }) as PublicKeyCredential | null;

      if (!credential) return false;
      localStorage.setItem(this.webAuthnKey(uid), bufferToBase64Url(credential.rawId));
      return true;
    } catch (err) {
      console.warn('[InnovaShift] WebAuthn enrollment failed.', err);
      return false;
    }
  }

  async disable(uid: string): Promise<void> {
    if (!uid) return;
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key: this.prefKey(uid) });
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.webAuthnKey(uid));
    }
  }

  async unlock(uid: string): Promise<boolean> {
    if (!uid) return false;

    if (Capacitor.isNativePlatform()) {
      try {
        await BiometricAuth.authenticate({
          reason: 'Unlock InnovaShift',
          allowDeviceCredential: true,
          cancelTitle: 'Use password instead',
        });
        return true;
      } catch {
        return false;
      }
    }

    const storedId = typeof localStorage !== 'undefined' ? localStorage.getItem(this.webAuthnKey(uid)) : null;
    if (!storedId) return false;
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [{ id: base64UrlToBuffer(storedId), type: 'public-key' }],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      return !!assertion;
    } catch (err) {
      console.warn('[InnovaShift] WebAuthn unlock failed.', err);
      return false;
    }
  }

  /**
   * Arms the lock if the given uid has opted in. Called only on a
   * cold-boot session restore (never right after an interactive password
   * login — see SessionBootstrapService) and, on native, every time the
   * app resumes to the foreground.
   */
  async armIfEnabled(uid: string): Promise<void> {
    this.armedUid = uid;
    if (await this.isEnabled(uid)) {
      this.locked.set(true);
    }
  }

  disarm(): void {
    this.locked.set(false);
  }

  /** Called on sign-out so a subsequent fresh login never shows a stale lock screen. */
  reset(): void {
    this.armedUid = null;
    this.locked.set(false);
  }
}
