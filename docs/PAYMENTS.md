# Payments
## UPI QR (available now)
Admin > Store settings > Payments. Upload QR, enable, save. Verify every payment in your bank before pressing "mark as paid".
## Razorpay (when you have an account)
1. Create keys in Razorpay Dashboard (start in **Test mode**).
2. Set on the server only (never in browser code): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Restart.
3. Dashboard > Webhooks: URL `https://YOUR-DOMAIN/webhooks/razorpay`, same secret, events `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.
4. A "Cards, UPI, Net Banking" option appears at checkout automatically. Payment is confirmed only by a verified signature or webhook, matched to the stored order amount; refunds from the order page call the Razorpay refund API and stay "processing" until the webhook confirms.
5. Test a full payment, failure, duplicate webhook and refund in test mode before switching to live keys.
