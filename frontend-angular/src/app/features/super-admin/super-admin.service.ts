import { Injectable } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';

type AccessRole = 'staff'|'manager'|'scheduler'|'admin'|'hr';
type PlatformRole = 'superAdmin'|null;

@Injectable({ providedIn: 'root' })
export class SuperAdminService {

  private fn(name: string) {
    const functions = getFunctions(undefined, 'us-east1');
    return httpsCallable<any, any>(functions, name);
  }

  async createOrg(payload: {
    orgId: string;
    name: string;
    plan?: string;
    countryCode?: string;
    currencyCode?: string;
    payFrequency?: string;
    taxProfile?: string;
    payrollTaxNotes?: string;
    bootstrapAdminEmail?: string;
    bootstrapAdminDisplayName?: string;
    bootstrapAdminJobRole?: string;
  }) {
    const call = this.fn('createOrg');
    const res = await call({
      orgId: payload.orgId,
      name: payload.name,
      plan: payload.plan ?? 'free',
      countryCode: payload.countryCode ?? 'US',
      currencyCode: payload.currencyCode ?? 'USD',
      payFrequency: payload.payFrequency ?? 'biweekly',
      taxProfile: payload.taxProfile ?? 'us_federal_state',
      payrollTaxNotes: payload.payrollTaxNotes ?? null,
      bootstrapAdminEmail: payload.bootstrapAdminEmail ?? null,
      bootstrapAdminDisplayName: payload.bootstrapAdminDisplayName ?? null,
      bootstrapAdminJobRole: payload.bootstrapAdminJobRole ?? null,
    });
    return res.data;
  }

  async lookupUserByEmail(email: string) {
    const call = this.fn('lookupUserByEmail');
    const res = await call({ email });
    return res.data;
  }

  async updateOrg(payload: {
    orgId: string;
    name: string;
    industry?: string;
    timezone?: string;
    contactEmail?: string;
    plan?: string;
    planStatus?: string;
    countryCode?: string;
    currencyCode?: string;
    payFrequency?: string;
    taxProfile?: string;
    payrollTaxNotes?: string;
    maxEmployees?: number;
    defaultPayRate?: number;
    active?: boolean;
  }) {
    const call = this.fn('updatePlatformOrg');
    const res = await call(payload);
    return res.data;
  }

  async setUserClaims(payload: {
    uid: string;
    orgId: string;
    accessRole: AccessRole;
    jobRole: string;
    active?: boolean;
    platformRole?: PlatformRole;
  }) {
    const call = this.fn('adminSetUserClaims');
    const res = await call(payload);
    return res.data;
  }

  async manageUserMembership(payload: {
    uid: string;
    action: 'revoke' | 'transfer' | 'suspend';
    orgId?: string;
    toOrgId?: string;
    accessRole?: AccessRole | string;
    jobRole?: string;
    reason?: string;
  }) {
    const call = this.fn('adminManageUserMembership');
    const res = await call(payload);
    return res.data;
  }

  async getUserTransferRequests(limit: number = 50, status: 'pending' | 'approved' | 'rejected' = 'pending') {
    const call = this.fn('getUserTransferRequests');
    const res = await call({ limit, status });
    return res.data as any[];
  }

  async reviewUserTransferRequest(payload: {
    requestId: string;
    decision: 'approve' | 'reject';
    reviewNote?: string;
  }) {
    const call = this.fn('reviewUserTransferRequest');
    const res = await call(payload);
    return res.data;
  }

  async getAuditLogs(limit: number = 50) {
    const call = this.fn('getGlobalAuditLogs');
    const res = await call({ limit });
    return res.data as any[];
  }

  async createUsers(users: NewEmployeeInput[]): Promise<CreateUsersResult> {
    const call = this.fn('superAdminCreateUsers');
    const res = await call({ users });
    return res.data as CreateUsersResult;
  }

  async listContactRequests(limit: number = 100): Promise<ContactRequestItem[]> {
    const call = this.fn('listContactRequests');
    const res = await call({ limit });
    return Array.isArray(res.data?.items) ? res.data.items as ContactRequestItem[] : [];
  }

  async updateContactRequestStatus(requestId: string, status: ContactRequestStatus) {
    const call = this.fn('updateContactRequestStatus');
    const res = await call({ requestId, status });
    return res.data;
  }
}

export type ContactRequestStatus = 'new' | 'contacted' | 'converted' | 'dismissed';

export interface ContactRequestItem {
  id: string;
  name: string;
  organization: string;
  email: string;
  size: string;
  message?: string | null;
  status: ContactRequestStatus;
  createdAt: any;
  updatedAt?: any;
  reviewedBy?: string | null;
}

export interface NewEmployeeInput {
  email: string;
  displayName: string;
  orgId: string;
  accessRole: AccessRole;
  jobRole: string;
  payRate?: number | null;
  payType?: string;
  phone?: string;
  employeeNumber?: string;
  department?: string;
  hireDate?: string;
  photoURL?: string;
}

export interface CreateUsersRowResult {
  email: string;
  ok: boolean;
  uid?: string;
  isNewUser?: boolean;
  passwordResetLink?: string;
  error?: string;
}

export interface CreateUsersResult {
  results: CreateUsersRowResult[];
}
