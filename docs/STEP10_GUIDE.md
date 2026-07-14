# Step 10 Guide

## Admin Scheduler UX
Route: `/admin/scheduler`
- Click a shift => Shift Actions modal (no browser prompt)
- Assign => Staff picker modal with search (name/email/jobRole)
- Drag a time range => opens Create Shift drawer with prefilled start/end
- Drag/drop an event => server rescheduleShift

## Timesheets Print-to-PDF
Route: `/admin/timesheets`
- Select user + date range
- Click "Print / Save as PDF" => opens `/admin/timesheets/print?...`
- Use browser print dialog to Save as PDF

This keeps the MVP lightweight (no extra PDF dependencies) while producing a PDF artifact when needed.
