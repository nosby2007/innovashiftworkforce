# Seed Data (Emulator)

Create documents under `orgs/{orgId}`.

## Shifts
`orgs/ORG_001/shifts/SHIFT_001`
```json
{
  "orgId": "ORG_001",
  "title": "RN - Wound Care Visit",
  "locationName": "Perry, GA",
  "startAt": { "_seconds": 1760000000, "_nanoseconds": 0 },
  "endAt": { "_seconds": 1760003600, "_nanoseconds": 0 },
  "status": "open",
  "requiredJobRole": "RN",
  "payRate": 150
}
```
Note: In emulator UI, create Timestamp fields using the UI timestamp picker.

## Messages
`orgs/ORG_001/messages/MSG_001`
```json
{
  "orgId": "ORG_001",
  "title": "Welcome",
  "body": "Welcome to Innovacare Shift Management.",
  "createdAt": "<Timestamp>"
}
```

## Time Entries
Created by Functions check-in/out.
