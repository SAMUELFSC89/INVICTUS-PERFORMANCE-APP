# App Review Notes — Paid Athletic Championships

> Internal submission draft. Review before each App Store submission and update edition-specific dates/prizes.

## English draft

Invictus Performance offers developer-sponsored athletic competitions based exclusively on real-world physical performance. The paid Cardio and Strength championships are externally performed athletic events: participants run, walk or perform eligible strength workouts in the physical world during the published competition period. Results are determined by validated athletic performance under the official rules; there is no lottery, random draw, roulette, RNG or chance-based outcome.

The organizer and sponsor is INVICTUS PERFORMANCE E SOLUÇÕES LTDA., CNPJ 67.770.822/0001-22, Brazil. The official rules are fully available inside the app before enrollment, including eligibility (18+), entry fee, competition dates, prize distribution, scoring, tie-break criteria, integrity review, refunds, privacy and dispute procedures. The rules expressly state that Apple Inc. and the App Store are not sponsors, organizers, partners or otherwise involved in the competition or prizes.

The R$ 29.90 charge is a one-time registration fee for the externally performed athletic competition. On iOS, after accepting the official rules and identity/presence verification, the user is taken to a secure hosted Asaas checkout supporting PIX and credit card. The checkout is opened outside the app WebView using the system browser presentation. Returning from the browser does not unlock the competition. Enrollment is activated only after our authenticated backend receives financial confirmation from Asaas by webhook.

The app does not sell virtual currency, digital game items, randomized rewards, betting stakes or chance-based entries through this flow. Championship scoring is server-authoritative and based on eligible physical activities that pass integrity validation. Users cannot submit their own score/risk decision as authoritative.

The paid enrollment button is shown only when a real edition has published registration dates, competition dates, prize distribution and modality rules. Otherwise the screen remains informational and no checkout can be created.

## Portuguese reference

O Invictus Performance oferece competições esportivas promovidas pelo próprio desenvolvedor e determinadas exclusivamente por desempenho físico real. Os campeonatos pagos de Cardio e Musculação são realizados fisicamente fora do ambiente digital: o participante executa atividades reais durante o período publicado e a classificação decorre de desempenho validado conforme o regulamento. Não existe sorteio, roleta, RNG ou resultado por acaso.

O organizador e patrocinador é INVICTUS PERFORMANCE E SOLUÇÕES LTDA., CNPJ 67.770.822/0001-22. O regulamento oficial completo fica disponível no aplicativo antes da inscrição e informa elegibilidade 18+, taxa, calendário, premiação, pontuação, desempate, antifraude, revisão, reembolso, privacidade e contestação. O regulamento declara expressamente que Apple Inc. e App Store não patrocinam, organizam, participam ou se vinculam à competição ou à premiação.

A cobrança de R$ 29,90 é taxa avulsa de inscrição na competição esportiva realizada externamente. No iOS, após o aceite das regras e a confirmação de identidade/presença, o atleta é encaminhado a um Checkout seguro hospedado pelo Asaas, com PIX e cartão. O simples retorno do navegador não libera a participação: a inscrição é ativada somente quando o backend recebe a confirmação financeira autenticada do Asaas por webhook.

## Reviewer navigation

1. Sign in with the App Review test account supplied in App Store Connect.
2. Open **Campeonatos**.
3. Open **Campeonato de Musculação** or **Campeonato de Cardio**.
4. Review organizer, fee, edition, prize distribution, official rules and Apple disclaimer.
5. Enrollment is available only if the reviewed build points to an edition with registration currently open.

## Required before submission

Do not paste these notes unchanged if any item is missing from the production edition. Before submission confirm:

- edition dates are final;
- prize amounts/positions are final and visible in-app;
- regulation version/hash matches production;
- Asaas production checkout and webhook are configured;
- Apple disclaimer is visible;
- reviewer test credentials can reach the relevant screen;
- no Android-specific external checkout CTA has accidentally been exposed;
- support contact and organizer information are current;
- legal counsel has reviewed the final contest structure where required by applicable law.
