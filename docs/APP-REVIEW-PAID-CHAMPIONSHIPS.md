# App Review Notes — Invictus Performance (submission build)

> Submission state reviewed on 2026-09-18. Update these notes if the product behavior changes before upload.

## English draft for App Review

Invictus Performance is a fitness and training application for adults (18+). The submitted build allows users to record workouts, track fitness/health metrics with explicit platform permissions, use training/AI features, participate in non-cash community challenges and view fitness rankings.

### Subscriptions

Invictus Pro is a digital subscription. On iOS, purchase and restoration are performed through the App Store subscription flow (RevenueCat is used as the integration layer). The price and subscription period shown to the user are obtained from the store, and the backend verifies the resulting entitlement before enabling Pro features.

### Competitions in this submitted build

The community championship available in the submitted build is free and has no cash prize. Paid Cardio and Strength championship screens are informational / COMING SOON only. Registration and checkout for paid editions are disabled until a future edition is formally published with its own dates, organizer, rules, price and prize information.

The current challenges do not use wagers, pooled user money, random outcomes, lotteries, roulette, RNG or chance-based rewards. Invictus Coins are promotional ecosystem points and cannot be converted to cash or withdrawn by users in the submitted store experience.

### Health and fitness data

Apple Health / HealthKit access is requested only when the user chooses the relevant health/wearable functionality. The app requests read access for authorized fitness and health metrics used to display personal history, training metrics and reports. Health data is not sold or used for behavioral advertising.

### Location, camera and microphone

Location is used for gym search/check-in and for routes of outdoor cardio sessions initiated by the user. Camera/photo access is used when the user chooses to attach training evidence or record Power Lift evidence. Microphone access is used only as part of user-initiated Power Lift video recording.

### Account deletion

Account deletion can be initiated directly in the app from Profile > Settings > Delete my account. A public deletion resource is also available at:

https://www.invictusperformance.app.br/account-deletion.html

The deletion flow clearly informs users that deleting the Invictus account does not automatically cancel an App Store subscription, which must also be managed in the App Store if active.

### Login

The native iOS build uses the Invictus first-party email/password account flow. Google social login is not displayed in the native iOS build. Google login remains available on Android and Web.

## Reviewer navigation

1. Sign in with the App Review test account supplied in App Store Connect.
2. Open **Profile** to access account settings, subscription management, privacy/help and account deletion.
3. Open **Devices** to review Apple Health / wearable integration. Health permissions are requested only when the user chooses to connect/use the integration.
4. Open **Championships**. The community experience is free; paid Cardio/Strength editions remain informational and cannot be purchased in the submitted build.
5. Open **Health** (Pro test account if supplied) to review user-facing health metrics and reports.

## Before submitting in App Store Connect

- Supply a working reviewer account and any Pro entitlement needed to reach paid-gated screens without asking the reviewer to purchase.
- Confirm the App Privacy answers match the actual data categories used by the build.
- Confirm the privacy-policy URL and account-deletion URL are public and reachable.
- Confirm the auto-renewable subscription metadata, price, localization and review screenshot are configured.
- Confirm HealthKit capability and the privacy usage descriptions are present in the signed archive.
- Confirm location/camera/photo/microphone purposes match the permission dialogs in the archive.
- Confirm age rating reflects the 18+ product policy and the actual content shown in the submitted build.
- Do not enable a paid championship or external paid-registration CTA without a separate store/legal review and updated reviewer notes.
