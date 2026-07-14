export interface ShiftChatMessage {
  id: string;
  orgId: string;
  shiftId: string;
  senderUid: string;
  senderName: string;
  senderRole: string;
  message: string;
  createdAt: any; // Firestore Timestamp
  editedAt?: any;
}
