import { env } from '../config/env.mjs';
import { logger } from './logger.mjs';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function isTurnstileConfigured() {
  return !!env.TURNSTILE.SECRET_KEY;
}

/**
 * Verifies a Cloudflare Turnstile token server-side.
 * Returns true when Turnstile is not configured (feature disabled) so that
 * local and pre-launch flows are not blocked.
 */
export async function verifyTurnstile(token, ip) {
  if (!env.TURNSTILE.SECRET_KEY) return true;
  if (!token || typeof token !== 'string') return false;

  try {
    const body = new URLSearchParams({
      secret: env.TURNSTILE.SECRET_KEY,
      response: token,
    });
    if (ip) body.set('remoteip', ip);

    const r = await fetch(VERIFY_URL, { method: 'POST', body });
    const d = await r.json();
    return d.success === true;
  } catch (e) {
    logger.error('turnstile verification failed', { error: e.message });
    return false;
  }
}
