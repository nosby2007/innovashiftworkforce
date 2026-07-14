# Step 6 Notes

## FullCalendar
- Schedule page uses FullCalendar week view.
- Events are generated from assigned shifts.
- Click an event to see a minimal details alert (replace with modal later).

## Super Admin Provisioning
- `createOrg` (Function) creates both:
  - `orgDirectory/{orgId}`
  - `orgs/{orgId}`
- `lookupUserByEmail` returns uid for provisioning
- `adminSetUserClaims` assigns:
  - orgId, accessRole, platformRole (claims)
  - creates/updates `orgs/{orgId}/users/{uid}` (profile mirror)

## Next Improvements (Step 7)
- Admin Scheduler: drag/drop calendar + publish/assign
- Aggregations: server-side counters (open, assigned, coverage)
- Notifications: email/SMS for claimed shifts & messages
