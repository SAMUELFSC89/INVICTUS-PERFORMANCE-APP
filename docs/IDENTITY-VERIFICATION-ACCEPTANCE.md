# Identity verification acceptance criteria

## Account identity

An account is considered verified for financial actions only when all three checks are true:

- Email ownership is confirmed by Firebase Auth (`emailVerified`).
- Phone ownership is confirmed with an OTP delivered through Twilio Verify.
- CPF + birth date are confirmed against the official Receita Federal data source through Serpro, with cadastral status REGULAR.

A filled field is never treated as a verified field.

## Withdrawal

Withdrawals no longer use selfie/presence confirmation. Each withdrawal requires:

1. verified email;
2. verified phone;
3. verified CPF/Receita status REGULAR;
4. a fresh SMS OTP sent to the already verified phone;
5. successful OTP confirmation before `WithdrawalEngine.requestWithdrawal` is called.

The OTP is single-use, expires after 10 minutes and has a maximum of five attempts. A phone change invalidates the pending withdrawal confirmation.

## Branding

Email verification remains on Firebase Auth and must use the Invictus branded Firebase email template/custom domain configuration.

Twilio Verify uses `CustomFriendlyName=Invictus` (or `TWILIO_VERIFY_FRIENDLY_NAME`) so the verification message identifies Invictus where the destination/operator supports Verify branding.

## Fail closed

If Twilio or Serpro credentials are absent or invalid, the application must not silently mark the phone/CPF as verified and must not authorize a withdrawal.
