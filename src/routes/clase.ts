import { Router } from 'express'
import { supabaseAdmin } from '../lib/supabase.js'
import { authenticate } from '../middleware/auth.js'
import { requireRole } from '../middleware/requireRole.js'
import { fetchCalendarAppointments } from '../services/ghl.js'
import { fetchPixelEvents } from '../services/meta.js'
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

// "clase 13/mayo" → Date(2026-05-13). Año inferido tomando el candidato más
// cercano al `ref` (±6 meses), para tolerar tags creados al cambio de año.
function tagToClassDate(tag: string, ref: Date = new Date()): Date | null {
  const m = tag.toLowerCase().match(/clase\s+(\d{1,2})\/([a-záéíóú]+)/)
  if (!m) return null
  const month = MONTH_MAP[m[2]]
  if (!month) return null
  const day = m[1].padStart(2, '0')

  const refYear = ref.getUTCFullYear()
  const candidates = [refYear - 1, refYear, refYear + 1]
    .map(y => new Date(`${y}-${month}-${day}T00:00:00Z`))
    .filter(d => !isNaN(d.getTime()))
  if (candidates.length === 0) return null

  candidates.sort(
    (a, b) => Math.abs(a.getTime() - ref.getTime()) - Math.abs(b.getTime() - ref.getTime()),
  )
  return candidates[0]
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

    // Enriquecer con lp_views desde tracking automático
    const { count: lpCount } = await supabaseAdmin
      .from('lp_pageviews')
      .select('*', { count: 'exact', head: true })
      .eq('tag', tag)

    const enriched = {
      ...(data as Record<string, unknown>),
      lp_views: lpCount ?? 0,
    }

    res.json(enriched)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 })
  }
})

// GET /api/clase/lp-views?tag=clase+29/abril
claseRouter.get('/lp-views', authenticate, async (req, res) => {
  try {
    const tag = (req.query['tag'] as string | undefined) ?? null
    if (!tag) { res.status(400).json({ error: 'tag requerido', status: 400 }); return }

    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('value, updated_at')
      .eq('key', `lp_views:${tag}`)
      .maybeSingle()

    if (error) { res.status(500).json({ error: error.message, status: 500 }); return }
    res.json({
      tag,
      lp_views:   data?.value ? Number(data.value) : null,
      updated_at: data?.updated_at ?? null,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 })
  }
})

// POST /api/clase/lp-views  { tag, lp_views }
claseRouter.post('/lp-views', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { tag, lp_views } = req.body as { tag?: string; lp_views?: number }
    if (!tag?.trim()) { res.status(400).json({ error: 'tag requerido', status: 400 }); return }
    if (lp_views === undefined || lp_views === null || Number.isNaN(Number(lp_views)) || Number(lp_views) < 0) {
      res.status(400).json({ error: 'lp_views debe ser >= 0', status: 400 }); return
    }

    const { error } = await supabaseAdmin
      .from('app_settings')
      .upsert({
        key:        `lp_views:${tag.trim()}`,
        value:      String(Math.round(Number(lp_views))),
        updated_at: new Date().toISOString(),
      })

    if (error) { res.status(500).json({ error: error.message, status: 500 }); return }
    res.json({ success: true, tag: tag.trim(), lp_views: Math.round(Number(lp_views)) })
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

// ── Pixel events (gracias-general.html · Lead, Contact, WhatsAppGroupClick) ───
// Devuelve los eventos del pixel agregados por las campañas [CLASE SEM] del
// período (o de la semana asociada al tag). Sirve para validar que el pixel
// está disparando lo esperado y para pintar tiles en ClaseEnVivo sin tocar la
// landing.
//
// GET /api/clase/pixel-events?tag=clase+29/abril&since=&until=
claseRouter.get('/pixel-events', authenticate, async (req, res) => {
  try {
    const tag = (req.query['tag'] as string | undefined)?.trim() || null
    const now = new Date()
    const reqUntil = (req.query['until'] as string | undefined) ?? now.toISOString().slice(0, 10)
    const reqSince = (req.query['since'] as string | undefined)
      ?? new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)

    // Si hay tag, usamos la semana de la clase para buscar la campaña que corrió.
    const weekRange = tag ? tagToWeekRange(tag) : null
    const since = weekRange?.since ?? reqSince
    const until = weekRange?.until ?? reqUntil

    const all = await fetchPixelEvents(since, until)

    // Filtrar a campañas de Clase en Vivo
    const claseRows = all.filter((r) =>
      (r.campaign_name ?? '').toLowerCase().includes('clase sem')
    )

    // Eventos que nos interesan reportar (mapeo a label legible).
    // El action_type real puede variar: Meta a veces usa el alias canónico
    // ('lead', 'contact_total') y a veces el namespaced del pixel
    // ('offsite_conversion.fb_pixel_lead'). Sumamos cualquiera que coincida.
    const TARGETS: Array<{ key: string; label: string; matchers: (t: string) => boolean }> = [
      {
        key: 'page_view',
        label: 'PageView',
        matchers: (t) =>
          t === 'page_view' ||
          t === 'landing_page_view' ||
          t === 'offsite_conversion.fb_pixel_view_content' ||
          t.endsWith('.fb_pixel_page_view'),
      },
      {
        key: 'lead',
        label: 'Lead',
        matchers: (t) => t === 'lead' || t.endsWith('.fb_pixel_lead'),
      },
      {
        key: 'complete_registration',
        label: 'CompleteRegistration',
        matchers: (t) =>
          t === 'complete_registration' ||
          t.endsWith('.fb_pixel_complete_registration'),
      },
      {
        key: 'contact',
        label: 'Contact',
        matchers: (t) =>
          t === 'contact_total' || t === 'contact' || t.endsWith('.fb_pixel_contact'),
      },
      {
        key: 'wa_group_click',
        label: 'WhatsAppGroupClick',
        matchers: (t) => t.toLowerCase().includes('whatsappgroupclick'),
      },
    ]

    // Acumular totales y por campaña
    const totals: Record<string, { count: number; cost_per: number; spend_share: number }> = {}
    const byCampaign: Array<{
      campaign_id:   string
      campaign_name: string
      spend:         number
      events:        Record<string, number>
      raw_actions:   Record<string, number>
    }> = []

    for (const t of TARGETS) totals[t.key] = { count: 0, cost_per: 0, spend_share: 0 }

    let totalSpend = 0

    for (const row of claseRows) {
      totalSpend += row.spend

      const events: Record<string, number> = {}
      for (const t of TARGETS) {
        let count = 0
        let costAcc = 0
        let costN = 0
        for (const [actionType, value] of Object.entries(row.actions)) {
          if (t.matchers(actionType)) {
            count += value
            const cpa = row.cost_per_action[actionType]
            if (cpa && value > 0) { costAcc += cpa * value; costN += value }
          }
        }
        events[t.key] = count
        totals[t.key].count += count
        totals[t.key].cost_per += costAcc
        totals[t.key].spend_share += costN
      }

      byCampaign.push({
        campaign_id:   row.campaign_id,
        campaign_name: row.campaign_name,
        spend:         row.spend,
        events,
        raw_actions:   row.actions,
      })
    }

    // cost_per final: weighted average por campaña
    const totalsOut = TARGETS.map((t) => {
      const agg = totals[t.key]
      return {
        key:      t.key,
        label:    t.label,
        count:    agg.count,
        cost_per: agg.spend_share > 0 ? agg.cost_per / agg.spend_share : 0,
      }
    })

    res.json({
      since,
      until,
      tag,
      total_spend:   totalSpend,
      campaign_count: claseRows.length,
      totals:        totalsOut,
      by_campaign:   byCampaign,
    })
  } catch (err) {
    console.warn('[Clase/PixelEvents] error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 })
  }
})

// ── Configuración del calendario ──────────────────────────────────────────────

const CALENDAR_KEY = 'ghl_calendar_id'

// GET /api/clase/calendar-config
claseRouter.get('/calendar-config', authenticate, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', CALENDAR_KEY)
      .maybeSingle()

    if (error) { res.status(500).json({ error: error.message, status: 500 }); return }

    res.json({ calendar_id: data?.value ?? null })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 })
  }
})

// POST /api/clase/calendar-config   { calendar_id: string }
claseRouter.post('/calendar-config', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { calendar_id } = req.body as { calendar_id?: string }
    if (!calendar_id?.trim()) {
      res.status(400).json({ error: 'calendar_id requerido', status: 400 }); return
    }

    const { error } = await supabaseAdmin
      .from('app_settings')
      .upsert({ key: CALENDAR_KEY, value: calendar_id.trim(), updated_at: new Date().toISOString() })

    if (error) { res.status(500).json({ error: error.message, status: 500 }); return }

    res.json({ success: true, calendar_id: calendar_id.trim() })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 })
  }
})

// GET /api/clase/appointments?since=YYYY-MM-DD&until=YYYY-MM-DD&tag=clase+29/abril
// Llama a GHL Calendar API con el calendar_id guardado y devuelve el conteo de citas.
// Si se provee `tag`, filtra a leads con ese tag y amplía la ventana de búsqueda
// para capturar agendamientos posteriores a la fecha de la clase.
claseRouter.get('/appointments', authenticate, async (req, res) => {
  try {
    const now   = new Date()
    const tag   = (req.query['tag'] as string | undefined)?.trim() || null

    const reqUntil = (req.query['until'] as string | undefined) ?? now.toISOString().slice(0, 10)
    const reqSince = (req.query['since'] as string | undefined)
      ?? new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)

    // Si el tag tiene formato "clase DD/mes", la ventana se ancla a la fecha de la
    // clase: [fecha_clase, fecha_clase + 60 días]. La UI muestra "conversiones
    // post-clase", así que solo nos interesan citas EN o DESPUÉS del día del evento.
    // Esto evita arrastrar citas de otras clases anteriores cuyo lead acumuló el tag.
    // Si el tag no es parseable, respetamos el rango pedido por la UI sin expansión.
    const classDate = tag ? tagToClassDate(tag, now) : null
    const since = classDate
      ? classDate.toISOString().slice(0, 10)
      : reqSince
    const until = classDate
      ? new Date(classDate.getTime() + 60 * 86_400_000).toISOString().slice(0, 10)
      : reqUntil

    // Leer calendar_id guardado
    const { data: cfg, error: cfgError } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', CALENDAR_KEY)
      .maybeSingle()

    if (cfgError) { res.status(500).json({ error: cfgError.message, status: 500 }); return }
    if (!cfg?.value) {
      res.json({ count: null, calendar_id: null, since, until, tag })
      return
    }

    const appointments = await fetchCalendarAppointments(cfg.value, since, until)

    // Si hay tag, obtener los contact_ids de leads que tienen ese tag
    let allowedContactIds: Set<string> | null = null
    if (tag) {
      const { data: tagLeads, error: tagErr } = await supabaseAdmin
        .from('leads')
        .select('ghl_contact_id, tags')
        .contains('tags', [tag])
      if (tagErr) {
        console.warn('[Clase/Appointments] error filtrando leads por tag:', tagErr.message)
      }
      allowedContactIds = new Set(
        (tagLeads ?? [])
          .map(l => l.ghl_contact_id)
          .filter((id): id is string => Boolean(id)),
      )
    }

    // Aplicar filtro de tag (si corresponde)
    let filtered = allowedContactIds
      ? appointments.filter(a => a.contactId && allowedContactIds!.has(a.contactId))
      : appointments

    // Defensa: si tenemos fecha de la clase, descartamos citas previas a ese día.
    // GHL devuelve startTime con offset (p.ej. "2026-05-13T10:00:00-05:00"); usamos
    // el día calendario (slice 0..10) en hora local del evento para comparar.
    if (classDate) {
      const classDay = classDate.toISOString().slice(0, 10)
      filtered = filtered.filter(a => (a.startTime?.slice(0, 10) ?? '') >= classDay)
    }

    // Excluir canceladas y eliminadas
    const active = filtered.filter(a => a.appointmentStatus !== 'cancelled' && !a.deleted)

    // Enriquecer con datos del lead (nombre, email) leyendo de la tabla `leads`
    const contactIds = Array.from(new Set(filtered.map(a => a.contactId).filter(Boolean)))
    let contactsById = new Map<string, { name: string | null; email: string | null }>()
    if (contactIds.length > 0) {
      const { data: leads } = await supabaseAdmin
        .from('leads')
        .select('ghl_contact_id, name, email')
        .in('ghl_contact_id', contactIds)
      contactsById = new Map(
        (leads ?? []).map(l => [l.ghl_contact_id, { name: l.name, email: l.email }])
      )
    }

    const items = filtered
      .slice()
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .map(a => {
        const c = contactsById.get(a.contactId)
        return {
          id:           a.id,
          contact_id:   a.contactId,
          contact_name: c?.name ?? null,
          contact_email: c?.email ?? null,
          start_time:   a.startTime,
          end_time:     a.endTime,
          status:       a.appointmentStatus,
          cancelled:    a.appointmentStatus === 'cancelled' || a.deleted,
          title:        a.title ?? null,
        }
      })

    res.json({
      count:       active.length,
      total:       filtered.length,
      cancelled:   filtered.length - active.length,
      calendar_id: cfg.value,
      since,
      until,
      tag,
      items,
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Error interno', status: 500 })
  }
})
