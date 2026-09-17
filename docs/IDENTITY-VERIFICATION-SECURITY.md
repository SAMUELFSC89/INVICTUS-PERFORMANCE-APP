# Security invariants

- Client code cannot set `emailVerified`, `phoneVerified`, or `cpfVerified` as trusted truth.
- Email truth comes from Firebase Admin/Auth.
- Phone truth requires Twilio Verify approval for the number being persisted.
- CPF truth requires the configured Serpro/Receita response and REGULAR status.
- Withdrawal OTP documents are user-bound, phone-bound, expiring and single-use.
- A failed provider call never upgrades verification state.
