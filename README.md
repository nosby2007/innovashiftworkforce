# Innovacare Shift Management — Step 10 Pack
## Modal UI (no more prompts) + Staff Picker Search + Shift Create Drawer + Timesheets Print-to-PDF

This pack improves operator UX while keeping the MVP architecture intact:
- Admin Scheduler: replaces prompt() with reusable modal components
  - Shift actions modal (publish/unpublish/assign/unassign)
  - Staff picker modal with search (name/email/jobRole)
  - Range-create drawer form (createShift)
- Timesheets: adds Print view route (browser Print -> Save as PDF)
  - `/admin/timesheets/print?uid=...&from=YYYY-MM-DD&to=YYYY-MM-DD`

### No new Functions required
Uses existing callables:
- `createShift`, `rescheduleShift`
- `publishShift`, `assignShift`, `unassignShift`

### Run
Same as Step 9.
