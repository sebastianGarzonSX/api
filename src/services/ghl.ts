import type {
  GHLContact,
  GHLContactsResponse,
  GHLOpportunity,
  GHLOpportunitiesResponse,
  GHLPipeline,
  GHLPipelinesResponse,
  GHLCustomFieldDefinition,
  GHLCustomFieldDefinitionsResponse,
} from '../types/index.js'

const GHL_BASE_URL = 'https://services.leadconnectorhq.com'
const GHL_API_KEY  = process.env.GHL_API_KEY!
const GHL_LOCATION = process.env.GHL_LOCATION_ID!
const GHL_VERSION  = '2021-07-28'

if (!GHL_API_KEY || !GHL_LOCATION) {
  console.warn('[GHL] GHL_API_KEY o GHL_LOCATION_ID no definidos — sync deshabilitado.')
}

function ghlHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${GHL_API_KEY}`,
    'Version':       GHL_VERSION,
    'Content-Type':  'application/json',
  }
}

const GHL_TIMEOUT_MS = 30_000  // 30 s por request a GHL

async function ghlFetch<T>(path: string): Promise<T> {
  const url = `${GHL_BASE_URL}${path}`

  console.log(`[GHL] → ${url}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GHL_TIMEOUT_MS)

  const res = await fetch(url, { headers: ghlHeaders(), signal: controller.signal })
    .finally(() => clearTimeout(timer))

  console.log(`[GHL] ← ${res.status} ${res.statusText}`)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[GHL] Error body: ${body}`)
    throw new Error(`GHL ${res.status} en ${path}: ${body}`)
  }

  const json = await res.json() as T

  // Log compacto de la respuesta para ver estructura y conteos
  if (typeof json === 'object' && json !== null) {
    const keys = Object.keys(json as object)
    const preview: Record<string, unknown> = {}
    for (const k of keys) {
      const val = (json as Record<string, unknown>)[k]
      preview[k] = Array.isArray(val) ? `[${val.length} items]` : val
    }
    console.log(`[GHL] Respuesta:`, JSON.stringify(preview, null, 2))
  }

  return json
}

// ── Contactos ─────────────────────────────────────────────────────────────────

/**
 * Descarga contactos de GHL.
 * @param sinceEpochMs  Si se provee, solo trae contactos con dateAdded > este timestamp (ms).
 *                      Usado por el sync incremental. Omitir para sync completo.
 */
export async function fetchAllContacts(sinceEpochMs?: number): Promise<GHLContact[]> {
  const all: GHLContact[] = []
  let total: number | null = null
  let page = 0

  const baseParams = `locationId=${GHL_LOCATION}&limit=100${sinceEpochMs ? `&startAfter=${sinceEpochMs}` : ''}`
  let nextPath: string = `/contacts/?${baseParams}`

  console.log(`[GHL] Iniciando fetch de contactos. Location: "${GHL_LOCATION}"${sinceEpochMs ? ` — incremental desde ${new Date(sinceEpochMs).toISOString()}` : ' — completo'}`)

  while (true) {
    page++
    console.log(`[GHL] Contactos página ${page} — acumulados: ${all.length} / total: ${total ?? '?'}`)

    const data = await ghlFetch<GHLContactsResponse>(nextPath)

    if (total === null) total = data.meta.total ?? 0

    all.push(...data.contacts)

    // Condiciones de parada:
    // 1. Página incompleta (última página real)
    // 2. Ya tenemos todos los contactos según el total
    // 3. GHL no provee nextPageUrl
    if (
      data.contacts.length < 100 ||
      all.length >= total ||
      !data.meta.nextPageUrl
    ) break

    // Extraer solo el path+query de la URL completa que devuelve GHL
    nextPath = data.meta.nextPageUrl.replace(GHL_BASE_URL, '')
  }

  console.log(`[GHL] Fetch contactos completo: ${all.length} contactos`)
  return all
}

// ── Contacto individual ───────────────────────────────────────────────────────

export async function fetchContactById(contactId: string): Promise<GHLContact | null> {
  try {
    const data = await ghlFetch<{ contact: GHLContact }>(`/contacts/${contactId}`)
    return data.contact ?? null
  } catch {
    return null
  }
}

// ── Oportunidades ─────────────────────────────────────────────────────────────

export async function fetchAllOpportunities(): Promise<GHLOpportunity[]> {
  const all: GHLOpportunity[] = []
  let page = 1

  console.log(`[GHL] Iniciando fetch de oportunidades. Location: "${GHL_LOCATION}"`)

  while (true) {
    const params = new URLSearchParams({
      location_id: GHL_LOCATION,
      limit:       '100',
      page:        String(page),
    })

    console.log(`[GHL] Oportunidades página ${page} — params: ${params.toString()}`)

    const data = await ghlFetch<GHLOpportunitiesResponse>(
      `/opportunities/search?${params.toString()}`
    )

    all.push(...data.opportunities)
    console.log(`[GHL] Oportunidades acumuladas: ${all.length} / meta:`, data.meta)

    if (!data.meta.nextPage || data.opportunities.length < 100) break
    page++
  }

  return all
}

// ── Pipelines ─────────────────────────────────────────────────────────────────

export async function fetchAllPipelines(): Promise<GHLPipeline[]> {
  console.log(`[GHL] Fetch de pipelines. Location: "${GHL_LOCATION}"`)
  const data = await ghlFetch<GHLPipelinesResponse>(
    `/opportunities/pipelines?locationId=${GHL_LOCATION}`
  )
  console.log(`[GHL] ${data.pipelines.length} pipelines obtenidos`)
  return data.pipelines
}

// ── Appointments (Calendar) ───────────────────────────────────────────────────

export interface GHLAppointment {
  id:                string
  calendarId:        string
  contactId:         string
  startTime:         string   // ISO 8601
  endTime:           string
  appointmentStatus: string   // 'confirmed' | 'cancelled' | 'showed' | 'noshow' | ...
  title?:            string
  deleted:           boolean
}

interface GHLEventsResponse {
  events: GHLAppointment[]
}

/**
 * Obtiene citas de un calendario GHL en un rango de fechas.
 * Endpoint real: GET /calendars/events  (no /calendars/appointments)
 * Params: locationId, calendarId, startTime (ms), endTime (ms)
 */
export async function fetchCalendarAppointments(
  calendarId: string,
  since: string,   // YYYY-MM-DD
  until: string,   // YYYY-MM-DD
): Promise<GHLAppointment[]> {
  const startTime = new Date(since).getTime()
  const endTime   = new Date(until + 'T23:59:59').getTime()

  console.log(`[GHL] Calendar events calendarId="${calendarId}" ${since} → ${until}`)

  const params = new URLSearchParams({
    locationId: GHL_LOCATION,
    calendarId,
    startTime:  String(startTime),
    endTime:    String(endTime),
  })

  try {
    const data = await ghlFetch<GHLEventsResponse>(
      `/calendars/events?${params.toString()}`
    )
    return data.events ?? []
  } catch (err) {
    console.warn('[GHL] Error al obtener calendar events:', err)
    throw err
  }
}

// ── Custom Field Definitions ──────────────────────────────────────────────────

export async function fetchCustomFieldDefinitions(): Promise<GHLCustomFieldDefinition[]> {
  console.log(`[GHL] Fetch de custom field definitions. Location: "${GHL_LOCATION}"`)
  try {
    const data = await ghlFetch<GHLCustomFieldDefinitionsResponse>(
      `/custom-fields/?locationId=${GHL_LOCATION}`
    )
    console.log(`[GHL] ${data.customFields?.length ?? 0} custom fields obtenidos`)
    return data.customFields ?? []
  } catch (err) {
    console.warn(`[GHL] No se pudieron obtener custom fields:`, err)
    return []
  }
}
