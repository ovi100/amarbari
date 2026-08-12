import { afterEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { env } from '../src/config/env';
import { isTwilioConfigured, sendMessage } from '../src/services/messaging.service';

/**
 * `env` is a frozen-by-convention object literal, so the Twilio block is
 * mutated in place for the duration of a test and restored afterwards.
 */
const twilio = env.messaging.twilio as {
  accountSid: string;
  authToken: string;
  from: string;
  messagingServiceSid: string;
};

const original = { ...twilio };

function configureTwilio(overrides: Partial<typeof original> = {}) {
  Object.assign(twilio, {
    accountSid: 'AC_test_sid',
    authToken: 'test_token',
    from: '+15005550006',
    messagingServiceSid: '',
    ...overrides,
  });
}

afterEach(() => {
  Object.assign(twilio, original);
  vi.restoreAllMocks();
});

describe('Twilio SMS delivery', () => {
  it('is only considered configured with credentials and a sender', () => {
    Object.assign(twilio, { accountSid: '', authToken: '', from: '', messagingServiceSid: '' });
    expect(isTwilioConfigured()).toBe(false);

    Object.assign(twilio, { accountSid: 'AC_test_sid', authToken: 'test_token' });
    expect(isTwilioConfigured()).toBe(false); // no sender yet

    Object.assign(twilio, { from: '+15005550006' });
    expect(isTwilioConfigured()).toBe(true);
  });

  it('posts to the Twilio Messages API with basic auth and a From number', async () => {
    configureTwilio();
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { sid: 'SM123' } } as never);

    const result = await sendMessage('+8801711111111', 'Your code is 123456', 'SMS');

    expect(result).toMatchObject({ delivered: true, provider: 'twilio', channel: 'SMS', reference: 'SM123' });

    const [url, body, config] = post.mock.calls[0]!;
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json');
    expect((body as URLSearchParams).get('To')).toBe('+8801711111111');
    expect((body as URLSearchParams).get('Body')).toBe('Your code is 123456');
    expect((body as URLSearchParams).get('From')).toBe('+15005550006');
    expect(config).toMatchObject({ auth: { username: 'AC_test_sid', password: 'test_token' } });
  });

  it('prefers a Messaging Service SID over a bare From number', async () => {
    configureTwilio({ messagingServiceSid: 'MG_test_service' });
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { sid: 'SM456' } } as never);

    await sendMessage('+8801711111111', 'hello', 'SMS');

    const body = post.mock.calls[0]![1] as URLSearchParams;
    expect(body.get('MessagingServiceSid')).toBe('MG_test_service');
    expect(body.get('From')).toBeNull();
  });

  it('reports a failure instead of throwing when Twilio rejects the request', async () => {
    configureTwilio();
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('boom'));

    const result = await sendMessage('+8801711111111', 'hello', 'SMS');
    expect(result.delivered).toBe(false);
    expect(result.error).toMatch(/boom/);
  });

  it('falls back to the console provider when Twilio is not configured', async () => {
    Object.assign(twilio, { accountSid: '', authToken: '', from: '', messagingServiceSid: '' });
    const post = vi.spyOn(axios, 'post');

    const result = await sendMessage('+8801711111111', 'hello', 'SMS');

    expect(result).toMatchObject({ delivered: true, provider: 'console', channel: 'SMS' });
    expect(post).not.toHaveBeenCalled();
  });
});
