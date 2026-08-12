import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getRedisClient } from '../utils/keyValueStore';
import { verifyAccessToken } from '../services/token.service';
import prisma from '../utils/prisma';
import { getBotReply } from '../services/chatbot.service';

export const userRoom = (userId: string) => `room_user_${userId}`;
export const ADMIN_ROOM = 'room_admin_global';

interface SocketUser {
  id: string;
  role: Role;
  phone: string;
}

declare module 'socket.io' {
  interface Socket {
    authUser?: SocketUser;
  }
}

let io: Server | null = null;

export function getIo(): Server | null {
  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(userRoom(userId)).emit(event, payload);
}

export function emitToAdmins(event: string, payload: unknown) {
  io?.to(ADMIN_ROOM).emit(event, payload);
}

async function resolveAdminId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return admin?.id ?? null;
}

/**
 * Socket.io server with a JWT handshake (SRS 8.2).
 *
 * Room strategy: every authenticated user joins `room_user_{id}`; admins
 * additionally join `room_admin_global` so tenant traffic fans out to whichever
 * admins are online.
 */
export function initSockets(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.cors.origins, credentials: true },
    // Explicit fallback to long polling when the WebSocket upgrade fails
    // (QA matrix 7.2 "Real-time Messaging").
    transports: ['websocket', 'polling'],
    pingTimeout: 25_000,
  });

  const pub = getRedisClient();
  if (pub) {
    io.adapter(createAdapter(pub, pub.duplicate()));
    logger.info('Socket.io using the Redis adapter');
  } else {
    logger.warn('Socket.io running with the in-memory adapter (single process only)');
  }

  io.use((socket: Socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization?.startsWith('Bearer ')
        ? socket.handshake.headers.authorization.slice(7)
        : undefined);

    if (!token) return next(new Error('UNAUTHORIZED: missing access token'));
    try {
      const payload = verifyAccessToken(token);
      socket.authUser = { id: payload.sub, role: payload.role, phone: payload.phone };
      next();
    } catch {
      next(new Error('UNAUTHORIZED: invalid access token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.authUser!;
    socket.join(userRoom(user.id));
    if (user.role === Role.ADMIN) socket.join(ADMIN_ROOM);

    logger.debug(`socket connected: ${user.id} (${user.role})`);
    socket.emit('connection:ready', { userId: user.id, role: user.role });
    if (user.role === Role.USER) emitToAdmins('presence:online', { userId: user.id });

    socket.on('chat:send', async (raw: unknown, ack?: (res: unknown) => void) => {
      try {
        const payload = (raw ?? {}) as { receiverId?: string; message?: string };
        const message = String(payload.message ?? '').trim();
        if (!message) throw new Error('Message cannot be empty');
        if (message.length > 2000) throw new Error('Message is too long');

        // Tenants always talk to the property admin, whoever they addressed.
        const receiverId =
          user.role === Role.USER ? await resolveAdminId() : payload.receiverId ?? null;
        if (!receiverId) throw new Error('No recipient available');

        const saved = await prisma.chatMessage.create({
          data: { senderId: user.id, receiverId, message },
          include: { sender: { select: { id: true, fullName: true, role: true } } },
        });

        io!.to(userRoom(user.id)).to(userRoom(receiverId)).emit('chat:message', saved);
        if (user.role === Role.USER) emitToAdmins('chat:message', saved);
        ack?.({ success: true, data: saved });

        // Chatbot answers known keywords before a human picks the thread up.
        if (user.role === Role.USER) {
          const reply = await getBotReply(user.id, message);
          if (reply) {
            const botMessage = await prisma.chatMessage.create({
              data: {
                senderId: receiverId,
                receiverId: user.id,
                message: reply.message,
                isBot: true,
              },
              include: { sender: { select: { id: true, fullName: true, role: true } } },
            });
            io!.to(userRoom(user.id)).to(userRoom(receiverId)).emit('chat:message', botMessage);
            emitToAdmins('chat:message', botMessage);
          } else {
            emitToAdmins('chat:escalated', { userId: user.id, message: saved });
          }
        }
      } catch (error) {
        const message = (error as Error).message;
        socket.emit('chat:error', { message });
        ack?.({ success: false, error: message });
      }
    });

    socket.on('chat:typing', (raw: unknown) => {
      const { receiverId } = (raw ?? {}) as { receiverId?: string };
      const target = user.role === Role.USER ? ADMIN_ROOM : receiverId && userRoom(receiverId);
      if (target) io!.to(target).emit('chat:typing', { userId: user.id });
    });

    socket.on('chat:read', async (raw: unknown) => {
      const { partnerId } = (raw ?? {}) as { partnerId?: string };
      if (!partnerId) return;
      await prisma.chatMessage.updateMany({
        where: { senderId: partnerId, receiverId: user.id, read: false },
        data: { read: true },
      });
      io!.to(userRoom(partnerId)).emit('chat:read', { by: user.id });
    });

    socket.on('disconnect', () => {
      if (user.role === Role.USER) emitToAdmins('presence:offline', { userId: user.id });
      logger.debug(`socket disconnected: ${user.id}`);
    });
  });

  return io;
}

export async function closeSockets() {
  await io?.close();
  io = null;
}
