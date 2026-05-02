import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import type { ApiError } from '../types/index.js'

export const claseRouter = Router()

const MONTH_MAP: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03',    abril: '04',
  mayo:  '05', junio:   '06', julio:  '07',   agosto: '08',
  septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
}

// "clase 29/abril" → { since: "2026-04-22", until: "2026-04-29" }
// Devuelve la semana previa a la fecha de la clase (inclusive).
// Meta nombra la campaña con la fecha de INICIO, no con la fecha de la clase,
// así que buscamos campañas que corrieron durante esa semana.
function tagToWeekRange(tag: string): { since: string; until: string } | null {
  const m = tag.toLowerCase().match(/clase\s+(\d{1,2})\/([a-záéíóú]+)/)
  if (!m) return null
  const month = MONTH_MAP[m[2]]
  if (!month) return null

  const year      = new Date().getFullYear()
  const classDate = new Date(`${year}-${month}-${m[1].padStart(2, '0')}`)
  if (isNaN(classDate.getTime())) return null

  const weekStart = new Date(classDate.getTime() - 8 * 86_400_000)
  return {
    since: weekStart.toISOString().slice(0, 10),
    until: classDate.toISOString().slice(0, 10),
  }
}

// GET /api/clase/report?tag=clase+29/abril&since=&until=
claseRouter.get('/report', authenticate, async (req, res) => {
  try {
    const tag   = (req.query['tag']   as string | undefined) ?? null
    const now   = new Date()
    const until = (req.query['until'] as string | undefined) ?? now.toISOString().slice(0, 10)
    const since = (req.query['since'] as string | undefined)
      ?? new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)

    if (!tag) {
      res.status(400).json({ error: 'Parámetro "tag" requerido', status: 400 })
      return
    }

    const { data, error } = await supabaseAdmin.rpc('get_clase_report', {
      p_class_tag: tag,
      p_since:     since,
      p_until:     until,
    })

    if (error) {
      const err: ApiError = { error: error.message, code: 'DB_ERROR', status: 500 }
      res.status(500).json(err)
      return
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 })
  }
})

// GET /api/clase/summary?since=&until=
claseRouter.get('/summary', authenticate, async (req, res) => {
  try {
    const now   = new Date()
    const until = (req.query['until'] as string | undefined) ?? now.toISOString().slice(0, 10)
    const since = (req.query['since'] as string | undefined)
      ?? new Date(now.getTime() - 120 * 86_400_000).toISOString().slice(0, 10)

    const { data, error } = await supabaseAdmin.rpc('get_clases_summary', {
      p_since: since,
      p_until: until,
    })

    if (error) {
      const err: ApiError = { error: error.message, code: 'DB_ERROR', status: 500 }
      res.status(500).json(err)
      return
    }

    res.json(data ?? [])
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 })
  }
})

// GET /api/clase/meta?since=&until=&tag=clase+22/abril
// Devuelve métricas de Meta para la campaña que corresponde a ese tag.
// Si se provee tag, filtra por la fecha parseada del tag.
// Si no hay tag, devuelve todas las campañas [CLASE SEM] del período.
claseRouter.get('/meta', authenticate, async (req, res) => {
  try {
    const now   = new Date()
    const until = (req.query['until'] as string | undefined) ?? now.toISOString().slice(0, 10)
    const since = (req.query['since'] as string | undefined)
      ?? new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)
    const tag   = (req.query['tag'] as string | undefined) ?? null

    // Si hay tag, usar la semana de esa clase como rango de búsqueda de campaña.
    // Así capturamos la campaña que corrió esa semana sin importar su fecha interna.
    const weekRange   = tag ? tagToWeekRange(tag) : null
    const metaSince   = weekRange?.since ?? since
    const metaUntil   = weekRange?.until ?? until

    console.log(`[Clase/Meta] tag="${tag}" → weekRange=${JSON.stringify(weekRange)} → query ${metaSince}→${metaUntil}`)

    const { data, error } = await supabaseAdmin
      .from('meta_campaigns')
      .select('campaign_name, spend, clicks, impressions, conversions, ctr, cpm')
      .gte('date_start', metaSince)
      .lte('date_stop',  metaUntil)
      .ilike('campaign_name', '%CLASE SEM%')

    if (error) {
      res.status(500).json({ error: error.message, status: 500 })
      return
    }

    // Agregar por campaña
    const byName = new Map<string, {
      spend: number; clicks: number; impressions: number
      conversions: number; ctr: number; cpm: number; rows: number
    }>()

    for (const row of data ?? []) {
      const name = row.campaign_name ?? 'Sin nombre'
      const cur  = byName.get(name) ?? { spend: 0, clicks: 0, impressions: 0, conversions: 0, ctr: 0, cpm: 0, rows: 0 }
      cur.spend       += row.spend       ?? 0
      cur.clicks      += row.clicks      ?? 0
      cur.impressions += row.impressions ?? 0
      cur.conversions += row.conversions ?? 0
      cur.rows        += 1
      byName.set(name, cur)
    }

    const campaigns = [...byName.entries()].map(([name, m]) => ({
      campaign_name: name,
      spend:         m.spend,
      clicks:        m.clicks,
      impressions:   m.impressions,
      conversions:   m.conversions,
      cpc:           m.clicks > 0   ? m.spend / m.clicks      : 0,
      cpl:           m.conversions > 0 ? m.spend / m.conversions : 0,
      ctr:           m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0,
    })).sort((a, b) => b.spend - a.spend)

    res.json({ campaigns, since, until })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 })
  }
})
