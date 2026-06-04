import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

declare module "express" {
  interface Request {
    user?: {
      id: number;
      name: string;
      email: string;
      role: string;
      isSystem: boolean;
    };
  }
}

interface JWTPayload {
  sub: number;
  name: string;
  email: string;
  role: string;
  isSystem: boolean;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, secret) as unknown as JWTPayload;
    req.user = {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      isSystem: payload.isSystem,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const secret = process.env["JWT_SECRET"];
  const authHeader = req.headers.authorization;
  if (secret && authHeader?.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(authHeader.slice(7), secret) as unknown as JWTPayload;
      req.user = { id: payload.sub, name: payload.name, email: payload.email, role: payload.role, isSystem: payload.isSystem };
    } catch {
      // Invalid token — continue without user
    }
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.role !== "System Admin" && !req.user.isSystem)) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
