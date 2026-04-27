import type { Request, Response, NextFunction } from 'express'
import { supabaseAnon, supabaseAdmin } from '../lib/supabase.js'
import type { ApiError } from '../types/index.js'

/**
 * Middleware de autenticación.
 *
 * 1. Extrae el Bearer token del header Authorization.
 * 2. Verifica el JWT con Supabase Auth.
 * 3. Lee el rol del usuario desde public.users.
 * 4. Inyecta req.user = { id, email, role } para los route handlers.
 *
 * Retorna 401 si el token no existe, es inválido o expiró.
 * Retorna 403 si el usuario existe en auth pero no tiene perfil en public.users.
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    const err: ApiError = { error: 'Token de autorización requerido', code: 'MISSING_TOKEN', status: 401 }
    res.status(401).json(err)
    return
  }

  const token = authHeader.slice(7)

  // Verificar el JWT con Supabase Auth
  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token)

  if (authError || !user) {
    const err: ApiError = { error: 'Token inválido o expirado', code: 'INVALID_TOKEN', status: 401 }
    res.status(401).json(err)
    return
  }

  // Leer el perfil interno (rol) desde public.users
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, name, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    const err: ApiError = {
      error: 'Perfil de usuario no encontrado. Contacta al administrador.',
      code: 'NO_PROFILE',
      status: 403,
    }
    res.status(403).json(err)
    return
  }

  req.user = {
    id:    user.id,
    email: user.email!,
    role:  profile.role,
  }

  next()
}
