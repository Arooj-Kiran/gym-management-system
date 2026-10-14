import type { Role } from '@gms/shared';

declare global {
  namespace Express {
    interface AuthContext {
      sessionId: string;
      csrfToken: string;
      user: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        role: Role;
        mustChangePassword: boolean;
        lastLoginAt: Date | null;
      };
    }

    // `req.id` is declared by pino-http and set by the requestId middleware.
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
