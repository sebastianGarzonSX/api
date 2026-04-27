import { AuthenticatedUser } from './index.js'

// Extiende el Request de Express para incluir el usuario autenticado.
// El middleware auth.ts lo inyecta antes de llegar a los route handlers.
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser
    }
  }
}

export {}
