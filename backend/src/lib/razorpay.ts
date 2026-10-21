/**
 * Razorpay REST client (no SDK needed).
 *  - Store checkout uses the CLIENT's own keys -> money goes straight to the client (PDF §3 step 8)
 *  - Platform billing uses YOUR keys (PDF §11)
 */
import { HttpError } from './http-error';
import { hmacSha256, safeEqual } from './crypto';

export interface RazorpayKeys { keyId: string; keySecret: string }

export async function createRazorpayOrder(keys: RazorpayKeys, amountRupees: number, receipt: string,
  notes: Record<string, string> = {}): Promise<{ id: string; amount: number; currency: string }> {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString('base64'),
    },
    body: JSON.stringify({ amount: Math.round(amountRupees * 100), currency: 'INR', receipt: receipt.slice(0, 40), notes }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new HttpError(502, 'PAYMENT_GATEWAY_ERROR', `Razorpay error: ${txt.slice(0, 200)}`);
  }
  return res.json() as any;
}

/** Checkout signature = HMAC_SHA256(order_id|payment_id, key_secret) */
export function verifyCheckoutSignature(keySecret: string, orderId: string, paymentId: string, signature: string) {
  return safeEqual(hmacSha256(keySecret, `${orderId}|${paymentId}`), signature);
}

/** Webhook signature = HMAC_SHA256(raw body, webhook_secret) */
export function verifyWebhookSignature(webhookSecret: string, rawBody: Buffer, signature: string) {
  return safeEqual(hmacSha256(webhookSecret, rawBody.toString('utf8')), signature);
}
