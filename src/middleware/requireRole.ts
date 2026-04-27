import type { Request, Response, NextFunction } from 'express'
import type { Role, ApiError } from '../types/index.js'

/**
 * Factory de middleware de autorización por rol.
 *
 * Uso:
 *   router.post('/sync', authenticate, requireRole('admin'), syncHandler)
 *   router.get('/leads', authenticate, requireRole('admin', 'analista', 'viewer'), handler)
 *
 * Requiere que authenticate() haya corrido antes (req.user debe existir).
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      const err: ApiError = { error: 'No autenticado', code: 'UNAUTHENTICATED', status: 401 }
      res.status(401).json(err)
      return
    }

    if (!allowedRoles.includes(req.user.role)) {
      const err: ApiError = {
        error: `Acceso denegado. Se requiere rol: ${allowedRoles.join(' o ')}.`,
        code:  'FORBIDDEN',
        status: 403,
      }
      res.status(403).json(err)
      return
    }

    next()
  }
}
