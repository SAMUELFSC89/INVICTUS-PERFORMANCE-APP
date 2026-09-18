# Google Play Review — Invictus Performance

Submission audit date: 2026-09-18.

## Product state for the submitted Android build

- App is intended for adults (18+).
- Core use case is fitness/training, activity history, health/fitness metrics, rankings and training assistance.
- Performance Pro is a digital subscription and is purchased/restored through Google Play Billing (RevenueCat integration layer).
- Community championship is free and has no cash prize.
- Paid Cardio/Strength championships remain COMING SOON and registration/checkout is disabled in the submitted build.
- Current challenges have no wager, pooled user money, random outcome or cash withdrawal.
- Invictus Coins are promotional ecosystem points and cannot be converted to cash.

## Health Connect

The Android manifest requests read-only Health Connect categories used by the app's fitness/health reports. Write permissions brought by dependencies are explicitly removed. The permission rationale activity is declared.

Before release in Play Console, ensure the Health apps declaration lists only the data types actually requested by the submitted build and that each declared purpose matches the in-app feature.

## Account deletion

Users can initiate deletion in-app from Profile > Settings > Delete my account.

Public deletion resource for the Play Console account-deletion field:

https://www.invictusperformance.app.br/account-deletion.html

The public page also provides the official support/privacy e-mail and describes retention exceptions.

## Data Safety / privacy

The Play Console Data Safety form must match the actual app behavior, including account/profile data, precise location when used, health/fitness data, photos/video/audio when the user invokes those features, device/security data and subscription/payment metadata processed by service providers.

Privacy policy:

https://www.invictusperformance.app.br/legal/privacy_policy.md

## Permissions

The manifest intentionally declares fine/coarse location, camera, notifications, foreground-service location and Health Connect read permissions. Review the merged release manifest before upload to ensure no dependency reintroduced write-health permissions or unrelated sensitive permissions.

## Reviewer access

Provide a working test account. If gated Pro screens need to be reviewed, provide an account with Pro entitlement already active so the reviewer does not need to buy a subscription merely to inspect functionality.

## Final Play Console checks

- Data Safety completed and consistent with the build and privacy policy.
- Account deletion web URL configured.
- Health apps / Health Connect declaration completed with minimum necessary data types.
- Store listing contains an active privacy-policy URL.
- Google Play Billing subscription product is active and matches the product identifier expected by RevenueCat/backend verification.
- Content rating / target audience reflects 18+ positioning.
- Advertising declaration is accurate (the app must not claim ad use if none exists, and health data must not be used for advertising).
- App access instructions and reviewer credentials are current.
- Release AAB is built from the audited commit and the merged manifest is rechecked before rollout.
