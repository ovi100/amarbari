import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type MessagingChannel = 'WHATSAPP' | 'IMO';

export interface DispatchResult {
  delivered: boolean;
  provider: string;
  channel: MessagingChannel;
  reference?: string;
  error?: string;
}

/**
 * Free OTP delivery over WhatsApp / IMO (SRS 3.1.2).
 *
 * Providers are pluggable via MESSAGING_PROVIDER. The default `console`
 * provider logs the message, which keeps registration testable locally and in
 * CI without a paid gateway. IMO has no public business API, so it is routed
 * through the generic outbound webhook provider.
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
  const provider = channel === 'IMO' ? 'webhook' : env.messaging.provider;

  try {
    switch (provider) {
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
