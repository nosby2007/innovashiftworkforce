# Next Experience Rollback

The futuristic roster work is protected by organization-level feature flags stored on:

```text
orgs/{orgId}.experienceFlags
```

All flags default to `false`, so the stable experience remains active unless an admin explicitly enables a switch in **Admin > Org Settings > Next Experience Rollout**.

## Flags

- `nextRosterWorkflow`
- `nextSchedulerActions`
- `nextStaffAttendanceCard`
- `nextMobileShell`

## Soft rollback

Turn the relevant flag off in Org Settings and save. Users return to the stable experience without redeploying.

## Hard rollback

The stable Git tag created before this rollout is:

```powershell
git switch main
git checkout stable-before-futuristic-roster
npm.cmd --prefix frontend-angular run build:pwa
npm.cmd --prefix backend-firebase-functions run build
firebase deploy --only "hosting,functions" --project atlanta-e04aa --non-interactive
```

Use hard rollback only if the feature flags cannot be reached or a deployed function needs to be reverted.
