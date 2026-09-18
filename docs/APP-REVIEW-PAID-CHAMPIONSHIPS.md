# App Review Notes — Paid Athletic Championships

> Internal submission draft. Review before each App Store submission and update edition-specific dates/prizes.

## English draft

Invictus Performance offers developer-sponsored athletic competitions based exclusively on real-world physical performance. The paid Cardio and Strength championships are externally performed athletic events: participants run, walk or perform eligible strength workouts in the physical world during the published competition period. Results are determined by validated athletic performance under the official rules; there is no lottery, random draw, roulette, RNG or chance-based outcome.

The organizer and sponsor is INVICTUS PERFORMANCE E SOLUÇÕES LTDA., CNPJ 67.770.822/0001-22, Brazil. The official rules are fully available inside the app before enrollment, including eligibility (18+), entry fee, registration dates, competition dates, published result-homologation date, prize distribution, scoring, tie-break criteria, integrity review, refunds, privacy and dispute procedures. The rules expressly state that Apple Inc. and the App Store are not sponsors, organizers, partners or otherwise involved in the competition or prizes.

The R$ 29.90 charge is a one-time registration fee for the externally performed athletic competition. On iOS, after accepting the official rules and identity/presence verification, the user is taken to a secure hosted Asaas checkout supporting PIX and credit card. The checkout is opened outside the app WebView using the system browser presentation. Returning from the browser does not unlock the competition. Enrollment is activated only after our authenticated backend receives financial confirmation from Asaas by webhook.

The app does not sell virtual currency, digital game items, randomized rewards, betting stakes or chance-based entries through this flow. Championship scoring is server-authoritative and based on eligible physical activities that pass integrity validation. Users cannot submit their own score/risk decision as authoritative.

After the competition period ends, the result is not treated as final immediately. The backend waits until the published homologation date and completes integrity and financial checks. Pending activity reviews, unresolved ties at prize positions, payment disputes or reconciliation issues keep the edition from being finalized. Once finalized, the athlete can see the homologated result in the app and eligible cash prizes are credited by the backend according to the published prize distribution.

Each published edition has an immutable server-side identity. Registrations, scores and final settlement from a previous edition are not reused for a later edition of the same Cardio or Strength championship.

The paid enrollment button is shown only when a real edition has published registration dates, competition dates, homologation date, prize distribution and modality rules. Otherwise the screen remains informational and no checkout can be created.

## Portuguese reference

O Invictus Performance oferece competições esportivas promovidas pelo próprio desenvolvedor e determinadas exclusivamente por desempenho físico real. Os campeonatos pagos de Cardio e Musculação são realizados fisicamente fora do ambiente digital: o participante executa atividades reais durante o período publicado e a classificação decorre de desempenho validado conforme o regulamento. Não existe sorteio, roleta, RNG ou resultado por acaso.

O organizador e patrocinador é INVICTUS PERFORMANCE E SOLUÇÕES LTDA., CNPJ 67.770.822/0001-22. O regulamento oficial completo fica disponível no aplicativo antes da inscrição e informa elegibilidade 18+, taxa, janela de inscrição, período competitivo, data de homologação, premiação, pontuação, desempate, antifraude, revisão, reembolso, privacidade e contestação. O regulamento declara expressamente que Apple Inc. e App Store não patrocinam, organizam, participam ou se vinculam à competição ou à premiação.

A cobrança de R$ 29,90 é taxa avulsa de inscrição na competição esportiva realizada externamente. No iOS, após o aceite das regras e a confirmação de identidade/presença, o atleta é encaminhado a um Checkout seguro hospedado pelo Asaas, com PIX e cartão. O simples retorno do navegador não libera a participação: a inscrição é ativada somente quando o backend recebe a confirmação financeira autenticada do Asaas por webhook.

Após o fim da competição, o resultado permanece sujeito à homologação server-side na data publicada. Atividades ainda em revisão, empate técnico em posição premiada ou pendência financeira impedem a finalização automática. Somente depois da homologação o resultado final é exibido como definitivo e a premiação elegível é creditada pelo backend conforme a distribuição publicada.

## Reviewer navigation

1. Sign in with the App Review test account supplied in App Store Connect.
2. Open **Campeonatos**.
3. Open **Campeonato de Musculação** or **Campeonato de Cardio**.
4. Review organizer, fee, edition, registration/competition/homologation dates, prize distribution, official rules and Apple disclaimer.
5. Enrollment is available only if the reviewed build points to an edition with registration currently open.
6. A finalized test edition, when supplied for review, shows the authenticated athlete's own homologated result rather than treating the browser checkout return as competition success.

## Required before submission

Do not paste these notes unchanged if any item is missing from the production edition. Before submission confirm:

- registration, competition and homologation dates are final and visible;
- prize amounts/positions are final and visible in-app. **Note (edições com pote dinâmico, a partir de 09/2026):** o valor exibido antes e durante a inscrição é um mínimo garantido fixo (`CHAMPIONSHIP_*_PRIZES_JSON`), explicitamente rotulado como "PRÊMIO MÍNIMO GARANTIDO" — nunca vago ou "a definir". O prêmio de fato pago pode ser maior (calculado por `api/_lib/paid-championship-dynamic-prize.ts` a partir do número de inscritos pagos), mas o app só revela esse valor final depois que as inscrições fecham, e nunca paga menos que o mínimo publicado. Isso mantém o requisito da Apple: a quantia garantida é final e visível antes da inscrição;
- regulation version/hash and edition identity match production;
- Asaas production checkout and authenticated payment webhook are configured;
- settlement cron and its server secret are configured;
- Apple disclaimer is visible;
- reviewer test credentials can reach the relevant screen;
- no Android-specific external checkout CTA has accidentally been exposed;
- support contact and organizer information are current;
- legal counsel has reviewed the final contest structure where required by applicable law.
