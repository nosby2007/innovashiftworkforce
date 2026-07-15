import { Injectable, NgZone } from '@angular/core';
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  orderBy,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage';
import { ConnectivityService } from '../connectivity/connectivity.service';

export type EmployeeDocumentType = 'identity' | 'w4' | 'w2' | 'certification' | 'payroll' | 'policy' | 'other';
export type EmployeeDocumentStatus = 'pending' | 'verified' | 'rejected';

export interface EmployeeDocumentRecord {
  id: string;
  orgId: string;
  userId: string;
  userDisplayName?: string | null;
  userEmail?: string | null;
  type: EmployeeDocumentType;
  title: string;
  fileName: string;
  storagePath: string;
  contentType?: string | null;
  size?: number | null;
  status: EmployeeDocumentStatus;
  uploadedAt?: any;
  uploadedBy?: string | null;
  reviewedAt?: any;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  updatedAt?: any;
}

type UploadInput = {
  orgId: string;
  userId: string;
  userDisplayName?: string | null;
  userEmail?: string | null;
  type: EmployeeDocumentType;
  title: string;
  file: File;
};

@Injectable({ providedIn: 'root' })
export class EmployeeDocumentsRepo {
  constructor(private zone: NgZone, private connectivity: ConnectivityService) {}

  watchForUser(orgId: string, userId: string, cb: (items: EmployeeDocumentRecord[]) => void) {
    const q = query(
      collection(getFirestore(), `orgs/${orgId}/employeeDocuments`),
      where('userId', '==', userId),
    );
    return onSnapshot(q, (snap) => {
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) } as EmployeeDocumentRecord))
        .sort((a, b) => this.ms(b.uploadedAt) - this.ms(a.uploadedAt));
      this.zone.run(() => cb(items));
    }, () => this.zone.run(() => cb([])));
  }

  watchOrgQueue(orgId: string, cb: (items: EmployeeDocumentRecord[]) => void, max = 100) {
    const q = query(
      collection(getFirestore(), `orgs/${orgId}/employeeDocuments`),
      orderBy('uploadedAt', 'desc'),
      limit(max),
    );
    return onSnapshot(q, (snap) => {
      this.zone.run(() => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as EmployeeDocumentRecord))));
    }, () => this.zone.run(() => cb([])));
  }

  async uploadEmployeeDocument(input: UploadInput): Promise<EmployeeDocumentRecord> {
    // Storage uploads don't queue offline like Firestore writes do — fail
    // fast with a clear message instead of hanging or erroring obscurely.
    this.connectivity.assertOnline();
    const docId = doc(collection(getFirestore(), `orgs/${input.orgId}/employeeDocuments`)).id;
    const safeName = this.safeFileName(input.file.name);
    const storagePath = `orgs/${input.orgId}/users/${input.userId}/documents/${docId}-${safeName}`;
    const storageRef = ref(getStorage(), storagePath);
    await uploadBytes(storageRef, input.file, {
      contentType: input.file.type || 'application/octet-stream',
      customMetadata: {
        documentId: docId,
        documentType: input.type,
      },
    });

    const record: Omit<EmployeeDocumentRecord, 'id'> = {
      orgId: input.orgId,
      userId: input.userId,
      userDisplayName: input.userDisplayName || null,
      userEmail: input.userEmail || null,
      type: input.type,
      title: input.title.trim() || this.labelFor(input.type),
      fileName: input.file.name,
      storagePath,
      contentType: input.file.type || null,
      size: input.file.size,
      status: 'pending',
      uploadedAt: serverTimestamp(),
      uploadedBy: input.userId,
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(getFirestore(), `orgs/${input.orgId}/employeeDocuments/${docId}`), record);
    return { id: docId, ...record };
  }

  async getDocumentUrl(record: EmployeeDocumentRecord): Promise<string> {
    return getDownloadURL(ref(getStorage(), record.storagePath));
  }

  labelFor(type: EmployeeDocumentType): string {
    const labels: Record<EmployeeDocumentType, string> = {
      identity: 'Identity Document',
      w4: 'W-4 Withholding',
      w2: 'W-2 Document',
      certification: 'License or Certification',
      payroll: 'Payroll Document',
      policy: 'Policy Acknowledgement',
      other: 'Other Document',
    };
    return labels[type] || 'Document';
  }

  private safeFileName(name: string): string {
    return String(name || 'document')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 96);
  }

  private ms(value: any): number {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return Number(value) || 0;
  }
}
