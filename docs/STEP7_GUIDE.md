# Step 7 Guide

## Admin Scheduler
Route: `/admin/scheduler`
- Click an event:
  - 1 publish
  - 2 unpublish
  - 3 assign (enter UID)
  - 4 unassign

## Notifications
Route: `/notifications`
- Shows per-user targeted notifications created by server.

## Metrics
Firestore doc:
- `orgs/{orgId}/metrics/summary`
Trigger updates on shift writes:
- openCount (status in open/published)
- assignedCount (status == assigned)
- upcoming7dOpenCount (open/published shifts with startAt within 7 days)

## Recommended emulator seed
1) Create org: `/super-admin` (must be superAdmin)
2) Provision yourself to an org (admin)
3) Create shifts under `orgs/{orgId}/shifts` with startAt/endAt (Timestamp), status `open`
4) Use Admin Scheduler to publish/assign.
