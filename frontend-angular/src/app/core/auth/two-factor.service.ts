import { Injectable } from '@angular/core';
import {
  EmailAuthProvider,
  MultiFactorResolver,
  TotpMultiFactorGenerator,
  TotpSecret,
  User,
  multiFactor,
  reauthenticateWithCredential,
} from 'firebase/auth';
import QRCode from 'qrcode';

const ISSUER = 'InnovaShift Workforce';

export interface TotpEnrollmentStart {
  secret: TotpSecret;
  secretKey: string;
  qrCodeDataUrl: string;
}

/**
 * Thin wrapper over Firebase Auth's built-in TOTP multi-factor support —
 * there is no custom backend here. Firebase verifies the 6-digit code
 * itself; this service only ever handles the shared secret and QR code
 * entirely client-side (the otpauth:// URL, which embeds the secret, is
 * rendered to a QR image locally via the `qrcode` package and never sent
 * anywhere).
 */
@Injectable({ providedIn: 'root' })
export class TwoFactorService {
  isEnrolled(user: User): boolean {
    return multiFactor(user).enrolledFactors.some((f) => f.factorId === 'totp');
  }

  enrolledSince(user: User): string | null {
    const factor = multiFactor(user).enrolledFactors.find((f) => f.factorId === 'totp');
    return factor?.enrollmentTime ?? null;
  }

  getEnrolledFactorUid(user: User): string | null {
    return multiFactor(user).enrolledFactors.find((f) => f.factorId === 'totp')?.uid ?? null;
  }

  /** Enrolling/unenrolling a second factor requires a recent sign-in — reauthenticate with the current password first. */
  async reauthenticate(user: User, password: string): Promise<void> {
    if (!user.email) throw new Error('Account has no email on file.');
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
  }

  async startEnrollment(user: User, accountLabel: string): Promise<TotpEnrollmentStart> {
    const session = await multiFactor(user).getSession();
    const secret = await TotpMultiFactorGenerator.generateSecret(session);
    const qrCodeUrl = secret.generateQrCodeUrl(accountLabel, ISSUER);
    const qrCodeDataUrl = await QRCode.toDataURL(qrCodeUrl, { width: 220, margin: 1 });
    return { secret, secretKey: secret.secretKey, qrCodeDataUrl };
  }

  async verifyAndEnroll(user: User, secret: TotpSecret, code: string, displayName: string): Promise<void> {
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim());
    await multiFactor(user).enroll(assertion, displayName);
  }

  async unenroll(user: User, factorUid: string): Promise<void> {
    await multiFactor(user).unenroll(factorUid);
  }

  /** Sign-in-time resolution after signInWithEmailAndPassword throws auth/multi-factor-auth-required. */
  async resolveTotpSignIn(resolver: MultiFactorResolver, code: string) {
    const hint = resolver.hints.find((h) => h.factorId === 'totp');
    if (!hint) throw new Error('No authenticator app is enrolled for this account.');
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim());
    return resolver.resolveSignIn(assertion);
  }
}
