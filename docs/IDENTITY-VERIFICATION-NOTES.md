# Production notes

- Do not enable financial withdrawals until Twilio Verify and Serpro production credentials are configured.
- The OTP flow is intentionally independent from the selfie/presence flow.
- Changing the verified phone requires verification of the new number before it can be used for a withdrawal.
- CPF verification stores only status/provider metadata on the user profile; the source CPF already exists in the account profile.
- Email verification truth comes from Firebase Authentication, not from a client-controlled Firestore flag.
