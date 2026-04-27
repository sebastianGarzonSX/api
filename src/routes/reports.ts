import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import type { ApiError } from '../types/index.js'

// =============================================================================
// GET /api/reports/attribution
// =============================================================================
// Informe unificado GHL + Meta:
//   - Leads por anuncio de Meta (cruzado con gasto Meta si está conectado)
//   - Funnel por pipeline (producto)
//   - Distribución por tags
//   - Totales Meta del período
//
// Query params:
//   since  YYYY-MM-DD  (default: hace 30 días)
//   until  YYYY-MM-DD  (default: hoy)
// =============================================================================

export const reportsRouter = Router()

reportsRouter.get('/attribution', authenticate, async (req, res) => {
  try {
    const now   = new Date()
    const until = (req.query['until'] as string | undefined) ?? now.toISOString().slice(0, 10)
    const since = (req.query['since'] as string | undefined)
      ?? new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)

    const { data, error } = await supabaseAdmin.rpc('get_attribution_report', {
      p_since: since,
      p_until: until,
    })

    if (error) {
      const err: ApiError = { error: error.message, code: 'DB_ERROR', status: 500 }
      res.status(500).json(err)
      return
    }

    res.json(data)
  } catch (err) {
    const apiErr: ApiError = {
      error:  err instanceof Error ? err.message : 'Error interno del servidor',
      status: 500,
    }
    res.status(500).json(apiErr)
  }
})
