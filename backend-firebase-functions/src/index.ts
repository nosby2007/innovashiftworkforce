import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall } from 'firebase-functions/v2/https';

initializeApp();
setGlobalOptions({ region: 'us-east1', cpu: 0.25, memory: '256MiB' });

import { externalNotifyCallable } from './callable/externalNotify';
import { getGlobalAuditLogs } from './callable/getGlobalAuditLogs';
import { rescheduleShift } from './callable/rescheduleShift';
import { createShift } from './callable/createShift';
import { onShiftWriteMetrics } from './triggers/onShiftWriteMetrics';
import { unassignShift } from './callable/unassignShift';
import { deleteShift } from './callable/deleteShift';
import { assignShift } from './callable/assignShift';
import { publishShift } from './callable/publishShift';
import { createNotification } from './callable/createNotification';
import { lookupUserByEmail } from './callable/lookupUserByEmail';
import { listPlatformOrgs } from './callable/listPlatformOrgs';
import { updatePlatformOrg } from './callable/updatePlatformOrg';
import { createOrg } from './callable/createOrg';
import { claimShift } from './callable/claimShift';
import { listShiftSwapCandidates, listShiftSwapRequests, requestShiftSwap, respondShiftSwap } from './callable/shiftSwap';
import { checkIn, checkOut, breakOut, breakIn } from './callable/checkInOut';
import { markMessageRead } from './callable/markMessageRead';
import { approveTimeCorrection } from './callable/approveTimeCorrection';
import { requestTimeCorrection } from './callable/requestTimeCorrection';
import { sendMessage } from './callable/sendMessage';
import { adminSetUserClaims } from './callable/adminSetUserClaims';
import { adminInviteUser } from './callable/adminInviteUser';
import { adminManageUserMembership } from './callable/adminManageUserMembership';
import { adminRequestUserTransfer } from './callable/adminRequestUserTransfer';
import { getUserTransferRequests } from './callable/getUserTransferRequests';
import { reviewUserTransferRequest } from './callable/reviewUserTransferRequest';
import { reviewEmployeeDocument } from './callable/reviewEmployeeDocument';
import { onUserCreate } from './triggers/onUserCreate';
import { listShifts } from './callable/listShifts';
import { expireShifts } from './callable/expireShifts';
import { contactIntake } from './http/contactIntake';
import { decideTimeOffRequest } from './callable/decideTimeOffRequest';
import { accrueTimeOff } from './callable/accrueTimeOff';

// ----------------------------------------------------------------------
// Stripe Billing
// ----------------------------------------------------------------------
export { stripeCreateCheckout } from './callable/stripeCreateCheckout';
export { stripeCreatePortal } from './callable/stripeCreatePortal';
export { stripeWebhook } from './webhooks/stripeWebhook';

// Debug
export const helloWorld = onCall(() => "Hello from Firebase!");

export {
  lookupUserByEmail,
  listPlatformOrgs,
  updatePlatformOrg,
  createOrg,
  claimShift,
  listShiftSwapCandidates,
  listShiftSwapRequests,
  requestShiftSwap,
  respondShiftSwap,
  checkIn,
  checkOut,
  breakOut,
  breakIn,
  markMessageRead,
  approveTimeCorrection,
  requestTimeCorrection,
  sendMessage,
  adminSetUserClaims,
  adminInviteUser,
  adminManageUserMembership,
  adminRequestUserTransfer,
  getUserTransferRequests,
  reviewUserTransferRequest,
  reviewEmployeeDocument,
  listShifts,
  onUserCreate,
  createNotification,
  publishShift,
  assignShift,
  unassignShift,
  deleteShift,
  onShiftWriteMetrics,
  createShift,
  rescheduleShift,
  externalNotifyCallable,
  getGlobalAuditLogs,
  expireShifts,
  contactIntake,
  decideTimeOffRequest,
  accrueTimeOff,
};
