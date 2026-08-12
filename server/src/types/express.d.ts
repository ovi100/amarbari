import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  role: Role;
  phone: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export {};
