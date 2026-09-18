# App Review Notes — Invictus Performance (submission build)

> Submission state reviewed on 2026-09-18. Update these notes if the product behavior changes before upload.

## English draft for App Review

Invictus Performance is a fitness and training application for adults (18+). The submitted build allows users to record workouts, track fitness/health metrics with explicit platform permissions, use training/AI features, participate in non-cash community challenges and view fitness rankings.

### Subscriptions

Invictus Pro is a digital subscription. On iOS, purchase and restoration are performed through the App Store subscription flow (RevenueCat is used as the integration layer). The price and subscription period shown to the user are obtained from the store, and the backend verifies the resulting entitlement before enabling Pro features.

### Competitions in this submitted build

The community championship available in the submitted build is free and has no cash prize.

Invictus Performance also offers developer-sponsored paid Cardio and Strength championships based exclusively on real-world physical performance: participants run, walk or perform eligible strength workouts in the physical world during the published competition period. Results are determined by validated athletic performance under the official rules; there is no lottery, random draw, roulette, RNG or chance-based outcome. The organizer and sponsor is INVICTUS PERFORMANCE E SOLUÇÕES LTDA., CNPJ 67.770.822/0001-22, Brazil. The official rules are fully available inside the app before enrollment, including eligibility (18+), entry fee, registration dates, competition dates, published result-homologation date, prize distribution, scoring, tie-break criteria, integrity review, refunds, privacy and dispute procedures. The rules expressly state that Apple Inc. and the App Store are not sponsors, organizers, partners or otherwise involved in the competition or prizes. The paid enrollment button is shown only when a real edition has published registration dates, competition dates, homologation date, prize distribution and modality rules; otherwise the screen remains informational and no checkout can be created.

The R$ 29.90 charge (or the price published for the active edition) is a one-time registration fee for the externally performed athletic competition. On iOS, after accepting the official rules and identity/presence verification, the user is taken to a secure hosted Asaas checkout supporting PIX and credit card, opened outside the app WebView using the system browser presentation. Returning from the browser does not unlock the competition; enrollment is activated only after our authenticated backend receives financial confirmation from Asaas by webhook. After the competition period ends, the result is not treated as final immediately — the backend waits until the published homologation date and completes integrity and financial checks before crediting eligible cash prizes.

The current challenges do not use wagers, pooled user money, random outcomes, lotteries, roulette, RNG or chance-based rewards. Invictus Coins are promotional ecosystem points and cannot be converted to cash or withdrawn by users.

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
4. Open **Championships**. The community experience is free. Open **Campeonato de Musculação** or **Campeonato de Cardio** to review organizer, fee, edition, registration/competition/homologation dates, prize distribution, official rules and Apple disclaimer. Enrollment is available only if the reviewed build points to an edition with registration currently open.
5. Open **Health** (Pro test account if supplied) to review user-facing health metrics and reports.

## Before submitting in App Store Connect

- Supply a working reviewer account and any Pro entitlement needed to reach paid-gated screens without asking the reviewer to purchase.
- Confirm the App Privacy answers match the actual data categories used by the build.
- Confirm the privacy-policy URL and account-deletion URL are public and reachable.
- Confirm the auto-renewable subscription metadata, price, localization and review screenshot are configured.
- Confirm HealthKit capability and the privacy usage descriptions are present in the signed archive.
- Confirm location/camera/photo/microphone purposes match the permission dialogs in the archive.
- Confirm age rating reflects the 18+ product policy and the actual content shown in the submitted build.
- registration, competition and homologation dates for the active paid edition(s) are final and visible;
- prize amounts/positions are final and visible in-app. **Note (edições com pote dinâmico, a partir de 09/2026):** o valor exibido antes e durante a inscrição é um mínimo garantido fixo (`CHAMPIONSHIP_*_PRIZES_JSON`), explicitamente rotulado como "PRÊMIO MÍNIMO GARANTIDO" — nunca vago ou "a definir". O prêmio de fato pago pode ser maior (calculado por `api/_lib/paid-championship-dynamic-prize.ts` a partir do número de inscritos pagos), mas o app só revela esse valor final depois que as inscrições fecham, e nunca paga menos que o mínimo publicado;
- regulation version/hash and edition identity match production;
- Asaas production checkout and authenticated payment webhook are configured;
- settlement cron and its server secret are configured;
- Apple disclaimer is visible;
- no Android-specific external checkout CTA has accidentally been exposed (Android enrollment routes to the official website instead);
- support contact and organizer information are current;
- legal counsel has reviewed the final contest structure where required by applicable law.
