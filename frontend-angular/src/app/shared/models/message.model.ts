export interface OrgMessage {
  id: string;
  orgId: string;
  title: string;
  body: string;
  createdAt: any; // Firestore Timestamp
  createdBy?: string | null;
  tags?: string[];
}
