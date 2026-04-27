import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL             = process.env.SUPABASE_URL!
const SUPABASE_ANON_KEY        = process.env.SUPABASE_ANON_KEY!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Faltan variables de entorno de Supabase. Revisar .env')
}

/**
 * Cliente con anon key.
 * Uso: verificar JWTs de usuarios via supabase.auth.getUser(token).
 * Respeta RLS — no puede escribir en tablas protegidas.
 */
export const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/**
 * Cliente con service role key.
 * Uso: todas las operaciones de escritura en DB (sync con GHL, upserts).
 * BYPASEA RLS — usar solo en el servidor, nunca exponer.
 */
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
