import { describe, expect, it } from 'vitest';
import { getBotReply } from '../src/services/chatbot.service';

// These keyword branches answer from static content and never touch the database.
const USER = '00000000-0000-0000-0000-000000000000';

describe('chatbot keyword engine (SRS 8.2)', () => {
  it('answers /help with the command menu', async () => {
    const reply = await getBotReply(USER, '/help');
    expect(reply?.message).toContain('/rent');
    expect(reply?.message).toContain('/due');
    expect(reply?.escalate).toBe(false);
  });

  it('answers /contact with emergency numbers', async () => {
    const reply = await getBotReply(USER, '/contact');
    expect(reply?.message).toMatch(/emergency/i);
  });

  it('answers /rules with the building rules', async () => {
    const reply = await getBotReply(USER, '/rules');
    expect(reply?.message).toMatch(/quiet hours/i);
  });

  it('explains how to file a maintenance ticket', async () => {
    const reply = await getBotReply(USER, '/ticket');
    expect(reply?.message).toMatch(/PENDING/);
  });

  it('matches keywords with and without the slash prefix', async () => {
    const withSlash = await getBotReply(USER, '/rules');
    const without = await getBotReply(USER, 'rules');
    expect(without?.message).toBe(withSlash?.message);
  });

  it('is case-insensitive', async () => {
    const reply = await getBotReply(USER, '/CONTACT');
    expect(reply?.message).toMatch(/emergency/i);
  });

  it('escalates unknown messages to a human admin', async () => {
    const reply = await getBotReply(USER, 'The lift has been stuck since this morning');
    expect(reply).toBeNull();
  });
});
