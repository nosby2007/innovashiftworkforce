# Next Experience Rollback

The futuristic roster work is protected by organization-level feature flags stored on:

```text
orgs/{orgId}.experienceFlags
```

All flags default to `false`, so the stable experience remains active unless an admin explicitly enables a switch in **Admin > Org Settings > Next Experience Rollout**.

## Flags

- `nextSchedulerActions`
- `nextStaffAttendanceCard`

`nextRosterWorkflow` and `nextMobileShell` were removed — they were scaffolded
in the original rollout but never got any consuming code, so toggling them
never changed anything. Separately, the `*ngIf` gating for the two flags
above was accidentally dropped during a merge-conflict resolution shortly
after the original rollout, which made their "next" UI permanent for
everyone regardless of the switch; that gating has since been restored.

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
