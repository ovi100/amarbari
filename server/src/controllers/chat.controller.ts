import { Request, Response } from 'express';
import { Role } from '@prisma/client';
import prisma from '../utils/prisma';
import { describeUnitOrNull } from '../services/unit.service';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { emitToAdmins, emitToUser } from '../sockets';
import { getBotReply } from '../services/chatbot.service';

async function counterpartFor(userId: string, role: Role, requested?: string) {
  if (role === Role.ADMIN) {
    if (!requested) throw ApiError.badRequest('receiverId is required');
    return requested;
  }
  const admin = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!admin) throw ApiError.notFound('No property admin is available');
  return admin.id;
}

/** Conversation history with one counterpart. */
export const getThread = asyncHandler(async (req: Request, res: Response) => {
  const me = req.user!;
  const partnerId = await counterpartFor(me.id, me.role, req.params.partnerId);

  const messages = await prisma.chatMessage.findMany({
    where: {
      OR: [
        { senderId: me.id, receiverId: partnerId },
        { senderId: partnerId, receiverId: me.id },
      ],
    },
    include: { sender: { select: { id: true, fullName: true, role: true } } },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });

  await prisma.chatMessage.updateMany({
    where: { senderId: partnerId, receiverId: me.id, read: false },
    data: { read: true },
  });

  res.json({ success: true, data: { partnerId, messages } });
});

/**
 * REST fallback for sending a message when the WebSocket is unavailable
 * (QA matrix 7.2 requires graceful degradation).
 */
export const postMessage = asyncHandler(async (req: Request, res: Response) => {
  const me = req.user!;
  const receiverId = await counterpartFor(me.id, me.role, req.body.receiverId);

  const saved = await prisma.chatMessage.create({
    data: { senderId: me.id, receiverId, message: req.body.message },
    include: { sender: { select: { id: true, fullName: true, role: true } } },
  });

  emitToUser(receiverId, 'chat:message', saved);
  emitToUser(me.id, 'chat:message', saved);
  if (me.role === Role.USER) emitToAdmins('chat:message', saved);

  let botMessage = null;
  if (me.role === Role.USER) {
    const reply = await getBotReply(me.id, req.body.message);
    if (reply) {
      botMessage = await prisma.chatMessage.create({
        data: { senderId: receiverId, receiverId: me.id, message: reply.message, isBot: true },
        include: { sender: { select: { id: true, fullName: true, role: true } } },
      });
      emitToUser(me.id, 'chat:message', botMessage);
      emitToAdmins('chat:message', botMessage);
    }
  }

  res.status(201).json({ success: true, data: { message: saved, botReply: botMessage } });
});

/** Admin inbox: one row per tenant with the latest message and unread count. */
export const listConversations = asyncHandler(async (req: Request, res: Response) => {
  const adminId = req.user!.id;

  const tenants = await prisma.user.findMany({
    where: { role: Role.USER, isApproved: true },
    select: {
      id: true,
      fullName: true,
      phone: true,
      tenancy: {
        select: {
          flat: { select: { flatNumber: true, building: true } },
          shop: { select: { shopNumber: true, shopName: true, address: true } },
        },
      },
    },
    orderBy: { fullName: 'asc' },
  });

  const conversations = await Promise.all(
    tenants.map(async (tenant) => {
      const [lastMessage, unread] = await Promise.all([
        prisma.chatMessage.findFirst({
          where: {
            OR: [
              { senderId: tenant.id, receiverId: adminId },
              { senderId: adminId, receiverId: tenant.id },
            ],
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.chatMessage.count({
          where: { senderId: tenant.id, receiverId: adminId, read: false },
        }),
      ]);
      return {
        tenant: { ...tenant, flatNumber: describeUnitOrNull(tenant.tenancy ?? {})?.number ?? null },
        lastMessage,
        unread,
      };
    })
  );

  conversations.sort((a, b) => {
    const at = a.lastMessage?.createdAt.getTime() ?? 0;
    const bt = b.lastMessage?.createdAt.getTime() ?? 0;
    return bt - at;
  });

  res.json({ success: true, data: conversations });
});
