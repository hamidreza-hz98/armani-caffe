# Customer SMS verification

The reusable SMS module is in `src/modules/sms`. `SmsService` accepts a `SmsSender` adapter and sends named template parameters. `SmsIrSender` is the current adapter. The customer OTP flow stores hashed, one time challenges in MongoDB; it never stores or logs the plain code. Challenges expire in 5 minutes, allow five verification attempts, and can be resent after 2 minutes. A shared limit caps SMS sends at 300 per 15 minutes. Run `npm run db:indexes:apply -- --apply` after deployment to install the TTL indexes.

Set these server-only values in `.env.local` for local use, or in the deployed server's environment:

```dotenv
SMSIR_API_KEY=your-panel-api-key
SMSIR_LOGIN_TEMPLATE_ID=123456
SMSIR_SIGNUP_TEMPLATE_ID=234567
SMSIR_CODE_PARAMETER=CODE
```

Both approved SMS.ir templates must contain the named `CODE` parameter (or change `SMSIR_CODE_PARAMETER` to match both templates). The application sends through [SMS.ir Panel V2's verification endpoint](https://github.com/IPeCompany/SmsPanelV2.TypeScript). No sender line is needed for template verification.

If all three credentials are empty, the customer login and signup sheet runs as a UI preview: it accepts arbitrary form values and any OTP text, sends no SMS, creates no customer, and issues no session. Supplying the API key and both template IDs enables real verification automatically after restart. In real mode, signup creates the customer after OTP validation and signs them in; login requires an existing active customer. Every new customer session lasts 365 days, including its cookie. Logout and account blocking revoke access.
