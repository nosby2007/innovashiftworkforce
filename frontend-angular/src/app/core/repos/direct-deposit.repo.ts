import { Injectable } from '@angular/core';
import { doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

export type BankAccountType = 'checking' | 'savings';

export interface DirectDepositInfo {
  bankName: string;
  accountType: BankAccountType;
  routingNumber: string;
  accountNumber: string;
  updatedAt?: any;
}

function docRef(orgId: string, uid: string) {
  return doc(getFirestore(), `orgs/${orgId}/users/${uid}/private/bankInfo`);
}

export function maskLast4(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length <= 4) return digits ? `••• ${digits}` : '';
  return `•••• ${digits.slice(-4)}`;
}

@Injectable({ providedIn: 'root' })
export class DirectDepositRepo {
  watch(orgId: string, uid: string, cb: (info: DirectDepositInfo | null) => void) {
    return onSnapshot(docRef(orgId, uid), (snap) => {
      cb(snap.exists() ? (snap.data() as DirectDepositInfo) : null);
    }, (error) => {
      console.warn('[InnovaShift] Direct deposit listener failed.', error);
      cb(null);
    });
  }

  async save(orgId: string, uid: string, info: { bankName: string; accountType: BankAccountType; routingNumber: string; accountNumber: string }): Promise<void> {
    await setDoc(docRef(orgId, uid), {
      bankName: info.bankName.trim(),
      accountType: info.accountType,
      routingNumber: info.routingNumber.trim(),
      accountNumber: info.accountNumber.trim(),
      updatedAt: serverTimestamp(),
    });
  }
}
