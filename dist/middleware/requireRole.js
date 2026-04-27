"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = requireRole;
/**
 * Factory de middleware de autorización por rol.
 *
 * Uso:
 *   router.post('/sync', authenticate, requireRole('admin'), syncHandler)
 *   router.get('/leads', authenticate, requireRole('admin', 'analista', 'viewer'), handler)
 *
 * Requiere que authenticate() haya corrido antes (req.user debe existir).
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            const err = { error: 'No autenticado', code: 'UNAUTHENTICATED', status: 401 };
            res.status(401).json(err);
            return;
        }
        if (!allowedRoles.includes(req.user.role)) {
            const err = {
                error: `Acceso denegado. Se requiere rol: ${allowedRoles.join(' o ')}.`,
                code: 'FORBIDDEN',
                status: 403,
            };
            res.status(403).json(err);
            return;
        }
        next();
    };
}
