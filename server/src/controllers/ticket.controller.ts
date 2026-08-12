import { Request, Response } from 'express';
import { Prisma, Role, TicketStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { publicUrlFor } from '../middlewares/upload';
import { emitToAdmins, emitToUser } from '../sockets';

const ticketInclude = {
  user: { select: { id: true, fullName: true, phone: true } },
  flat: { select: { id: true, flatNumber: true, floor: true, building: true } },
  shop: { select: { id: true, shopNumber: true, shopName: true, address: true } },
} satisfies Prisma.MaintenanceTicketInclude;

export const createTicket = asyncHandler(async (req: Request, res: Response) => {
  const tenancy = await prisma.tenancy.findUnique({ where: { userId: req.user!.id } });
  if (!tenancy?.isActive) {
    throw ApiError.badRequest('You must have an active tenancy to report an issue');
  }

  const ticket = await prisma.maintenanceTicket.create({
    data: {
      userId: req.user!.id,
      // Whichever unit the reporter occupies — a flat or a shop.
      flatId: tenancy.flatId,
      shopId: tenancy.shopId,
      category: req.body.category,
      description: req.body.description,
      imageUrl: req.file ? publicUrlFor(req.file.filename) : null,
    },
    include: ticketInclude,
  });

  // Real-time status tracker feed (SRS 3.1.5).
  emitToAdmins('ticket:created', ticket);

  res.status(201).json({ success: true, data: ticket });
});

export const listTickets = asyncHandler(async (req: Request, res: Response) => {
  const { status, category, flatId, page, pageSize } = req.query as unknown as {
    status?: TicketStatus;
    category?: string;
    flatId?: string;
    page: number;
    pageSize: number;
  };

  // Tenants only ever see their own tickets, whatever filters they pass.
  const where: Prisma.MaintenanceTicketWhereInput = {
    ...(req.user!.role === Role.USER ? { userId: req.user!.id } : {}),
    ...(status ? { status } : {}),
    ...(category ? { category: category as never } : {}),
    ...(flatId && req.user!.role === Role.ADMIN ? { flatId } : {}),
  };

  const [total, tickets] = await Promise.all([
    prisma.maintenanceTicket.count({ where }),
    prisma.maintenanceTicket.findMany({
      where,
      include: ticketInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({
    success: true,
    data: {
      tickets,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    },
  });
});

export const getTicket = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: req.params.id },
    include: ticketInclude,
  });
  if (!ticket) throw ApiError.notFound('Ticket not found');
  if (req.user!.role === Role.USER && ticket.userId !== req.user!.id) {
    throw ApiError.forbidden('This ticket belongs to another tenant');
  }
  res.json({ success: true, data: ticket });
});

export const updateTicketStatus = asyncHandler(async (req: Request, res: Response) => {
  const ticket = await prisma.maintenanceTicket.update({
    where: { id: req.params.id },
    data: { status: req.body.status },
    include: ticketInclude,
  });

  emitToUser(ticket.userId, 'ticket:updated', ticket);
  emitToAdmins('ticket:updated', ticket);

  res.json({ success: true, data: ticket });
});
