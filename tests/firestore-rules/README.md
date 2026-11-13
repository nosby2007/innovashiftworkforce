# Firestore rules regression tests

Runs `firestore.rules` in the local Firestore emulator with synthetic data. It needs no Firebase project and no credentials, and never touches a deployed database. Java 11+ is required for the emulator.

```bash
cd tests/firestore-rules
npm ci
npm test
```

`tenant-boundary.test.mjs` guards the platform/tenant boundary. An organization admin (`accessRole: 'admin'`) must never gain platform super-admin reach; only an explicit `platformRole: 'superAdmin'` grants it.
