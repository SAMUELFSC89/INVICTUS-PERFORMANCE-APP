# Test checklist

- GET identity status returns masked email, phone and CPF states.
- Email status is sourced from Firebase Auth.
- Phone OTP cannot verify a different account's phone.
- CPF verification only succeeds for a matching CPF + birth date with REGULAR status.
- Withdrawal without all identity checks returns `IDENTITY_VERIFICATION_REQUIRED`.
- Starting a withdrawal sends an OTP but does not reserve balance yet.
- Invalid OTP does not call the withdrawal engine.
- OTP expires after 10 minutes and is single-use.
- Valid OTP calls the withdrawal engine once.
- Selfie/presence modal is not used by Prize Wallet.
