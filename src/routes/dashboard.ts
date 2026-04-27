import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import type { DashboardKPIs, StageCount, SourceCount } from './dashboard.types.js'
import type { ApiError, LeadStage } from '../types/index.js'

// =============================================================================
// GET /api/dashboard/kpis
// =============================================================================
// Agrega métricas de leads y oportunidades para los 4 KPI cards del dashboard.
// Accesible por cualquier rol autenticado.
//
// Implementación:
//   - Usa la función RPC `get_dashboard_kpis` (migración 007) para ejecutar
//     todas las agregaciones en una sola llamada a Supabase.
//   - Cache: el cliente Next.js hace revalidación cada 15 minutos vía hook.
// =============================================================================

export const dashboardRouter = Router()

dashboardRouter.get('/kpis', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_dashboard_kpis')

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

// Tipos locales de la respuesta de la función RPC
// (se infieren del retorno de get_dashboard_kpis en migración 007)
export type { DashboardKPIs, StageCount, SourceCount }
