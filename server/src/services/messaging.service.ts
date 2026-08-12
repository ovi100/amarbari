import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type MessagingChannel = 'WHATSAPP' | 'IMO' | 'SMS';

export interface DispatchResult {
  delivered: boolean;
  provider: string;
  channel: MessagingChannel;
  reference?: string;
  error?: string;
}

/** Twilio is only usable once both halves of the API credential are present. */
export function isTwilioConfigured(): boolean {
  const { accountSid, authToken, from, messagingServiceSid } = env.messaging.twilio;
  return Boolean(accountSid && authToken && (from || messagingServiceSid));
}

/**
 * Picks the provider for a channel. SMS goes to Twilio, IMO has no public
 * business API so it rides the generic outbound webhook, and WhatsApp follows
 * MESSAGING_PROVIDER. Anything unconfigured falls back to `console` so the flow
 * stays completable in dev and CI.
 */
function providerFor(channel: MessagingChannel): string {
  if (channel === 'SMS') return isTwilioConfigured() ? 'twilio' : 'console';
  if (channel === 'IMO') return 'webhook';
  return env.messaging.provider;
}

/**
 * OTP delivery over WhatsApp / IMO / SMS (SRS 3.1.2).
 *
 * Providers are pluggable via MESSAGING_PROVIDER. The default `console`
 * provider logs the message, which keeps registration testable locally and in
 * CI without a paid gateway.
 */
export async function sendOtpMessage(
  phone: string,
  code: string,
  channel: MessagingChannel = 'WHATSAPP'
): Promise<DispatchResult> {
  const body =
    `AmarBari verification code: ${code}\n` +
    `This code expires in ${Math.round(env.otp.ttlSeconds / 60)} minutes. ` +
    `Do not share it with anyone.`;

  return sendMessage(phone, body, channel);
}

export async function sendMessage(
  phone: string,
  body: string,
  channel: MessagingChannel = 'WHATSAPP'
): Promise<DispatchResult> {
  const provider = providerFor(channel);

  try {
    switch (provider) {
      case 'twilio': {
        const { accountSid, authToken, from, messagingServiceSid } = env.messaging.twilio;
        // Twilio's REST API is a plain form POST with basic auth — no SDK needed.
        const params = new URLSearchParams({ To: phone, Body: body });
        if (messagingServiceSid) params.set('MessagingServiceSid', messagingServiceSid);
        else params.set('From', from);

        const res = await axios.post(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          params,
          { auth: { username: accountSid, password: authToken }, timeout: 10_000 }
        );
        return { delivered: true, provider, channel, reference: String(res.data?.sid ?? '') };
      }

      case 'ultramsg': {
        const { ultramsgInstanceId: instance, ultramsgToken: token } = env.messaging;
        const res = await axios.post(
          `https://api.ultramsg.com/${instance}/messages/chat`,
          new URLSearchParams({ token, to: phone, body }),
          { timeout: 10_000 }
        );
        return { delivered: true, provider, channel, reference: String(res.data?.id ?? '') };
      }

      case 'greenapi': {
        const { greenApiInstanceId: instance, greenApiToken: token } = env.messaging;
        const res = await axios.post(
          `https://api.green-api.com/waInstance${instance}/sendMessage/${token}`,
          { chatId: `${phone.replace(/\D/g, '')}@c.us`, message: body },
          { timeout: 10_000 }
        );
        return { delivered: true, provider, channel, reference: String(res.data?.idMessage ?? '') };
      }

      case 'webhook': {
        if (!env.messaging.webhookUrl) {
          logger.warn(`[${channel}] no webhook configured — message to ${phone} not dispatched`);
          return { delivered: false, provider, channel, error: 'MESSAGING_WEBHOOK_URL not set' };
        }
        const res = await axios.post(
          env.messaging.webhookUrl,
          { to: phone, channel, body },
          { timeout: 10_000 }
        );
        return { delivered: true, provider, channel, reference: String(res.data?.id ?? '') };
      }

      case 'console':
      default:
        logger.info(`[${channel} · console provider] to=${phone} :: ${body.replace(/\n/g, ' | ')}`);
        return { delivered: true, provider: 'console', channel };
    }
  } catch (error) {
    const message = axios.isAxiosError(error)
      ? `${error.response?.status ?? ''} ${JSON.stringify(error.response?.data ?? error.message)}`
      : (error as Error).message;
    logger.error(`[${channel}] dispatch to ${phone} failed via ${provider}: ${message}`);
    return { delivered: false, provider, channel, error: message };
  }
}
