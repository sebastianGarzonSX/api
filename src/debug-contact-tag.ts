/**
 * Debug puntual: comparar tags de un contacto entre Supabase (leads) y GHL en vivo,
 * y listar sus citas en el calendario configurado.
 *
 * Correr: npx tsx src/debug-contact-tag.ts diego@serviciosdeviajes.com.co [tag]
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const BASE = 'https://services.leadconnectorhq.com'
const KEY  = process.env.GHL_API_KEY!
const LOC  = process.env.GHL_LOCATION_ID!
const h    = {
  'Authorization': `Bearer ${KEY}`,
  'Version':       '2021-07-28',
  'Content-Type':  'application/json',
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: h })
  if (!r.ok) {
    const txt = await r.text()
    throw new Error(`GHL ${r.status} ${url}: ${txt}`)
  }
  return r.json() as Promise<T>
}

async function main() {
  const email = process.argv[2]
  const tagArg = process.argv[3] ?? null
  if (!email) {
    console.error('Uso: npx tsx src/debug-contact-tag.ts <email> [tag]')
    process.exit(1)
  }

  console.log(`\n🔎 Email: ${email}\n`)

  // ── 1. Lead local en Supabase ─────────────────────────────────────────────
  const { data: lead, error: lerr } = await supabase
    .from('leads')
    .select('id, ghl_contact_id, name, email, tags, stage, last_activity_at, updated_at')
    .ilike('email', email)
    .maybeSingle()
  if (lerr) console.warn('Supabase lead error:', lerr.message)

  console.log('=== Supabase (leads) ===')
  if (!lead) {
    console.log('  ❌ no existe lead local con ese email')
  } else {
    console.log('  id:               ', lead.id)
    console.log('  ghl_contact_id:   ', lead.ghl_contact_id)
    console.log('  name:             ', lead.name)
    console.log('  stage:            ', lead.stage)
    console.log('  tags (locales):   ', JSON.stringify(lead.tags))
    console.log('  last_activity_at: ', lead.last_activity_at)
    console.log('  updated_at (sync):', lead.updated_at)
  }

  // ── 2. Contacto en GHL en vivo ────────────────────────────────────────────
  console.log('\n=== GHL en vivo (contacts/search) ===')
  let ghlContact: any = null
  try {
    const sr = await fetch(`${BASE}/contacts/search`, {
      method:  'POST',
      headers: h,
      body:    JSON.stringify({
        locationId: LOC,
        pageLimit:  5,
        filters:    [{ field: 'email', operator: 'eq', value: email }],
      }),
    })
    const data = await sr.json() as any
    ghlContact = data.contacts?.[0] ?? null
  } catch (e) {
    console.warn('  search falló, intento por id local…', (e as Error).message)
  }

  if (!ghlContact && lead?.ghl_contact_id) {
    const data = await get<any>(`${BASE}/contacts/${lead.ghl_contact_id}`)
    ghlContact = data.contact ?? data
  }

  if (!ghlContact) {
    console.log('  ❌ no se encontró contacto en GHL')
  } else {
    console.log('  id:           ', ghlContact.id)
    console.log('  name:         ', ghlContact.contactName ?? `${ghlContact.firstName ?? ''} ${ghlContact.lastName ?? ''}`.trim())
    console.log('  email:        ', ghlContact.email)
    console.log('  tags (GHL):   ', JSON.stringify(ghlContact.tags))
    console.log('  dateAdded:    ', ghlContact.dateAdded)
    console.log('  dateUpdated:  ', ghlContact.dateUpdated)
  }

  // ── 3. Comparación de tags ────────────────────────────────────────────────
  if (lead && ghlContact) {
    const localSet  = new Set<string>(lead.tags ?? [])
    const remoteSet = new Set<string>(ghlContact.tags ?? [])
    const onlyLocal  = [...localSet].filter(t => !remoteSet.has(t))
    const onlyRemote = [...remoteSet].filter(t => !localSet.has(t))
    console.log('\n=== Diff tags (Supabase vs GHL) ===')
    console.log('  solo en Supabase (stale):', onlyLocal)
    console.log('  solo en GHL (no sincronizado):', onlyRemote)
    if (tagArg) {
      console.log(`\n  ¿filtro "${tagArg}" pasaría?`)
      console.log('    en leads.tags (Supabase):', localSet.has(tagArg))
      console.log('    en contact.tags (GHL):  ', remoteSet.has(tagArg))
    }
  }

  // ── 4. Citas en calendario configurado ────────────────────────────────────
  const { data: cfg } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'ghl_calendar_id')
    .maybeSingle()
  console.log('\n=== Calendario configurado ===')
  console.log('  calendar_id:', cfg?.value ?? '(ninguno)')

  if (cfg?.value && (lead?.ghl_contact_id || ghlContact?.id)) {
    const contactId = lead?.ghl_contact_id ?? ghlContact.id
    const now = Date.now()
    const startTime = now - 90 * 86_400_000
    const endTime   = now + 90 * 86_400_000
    const params = new URLSearchParams({
      locationId: LOC,
      calendarId: cfg.value,
      startTime:  String(startTime),
      endTime:    String(endTime),
    })
    const data = await get<any>(`${BASE}/calendars/events?${params.toString()}`)
    const events = (data.events ?? []) as any[]
    const ofThisContact = events.filter(e => e.contactId === contactId)
    console.log(`\n=== Citas del contacto en este calendario (±90 días) ===`)
    console.log(`  total eventos en ventana: ${events.length}`)
    console.log(`  eventos de este contacto: ${ofThisContact.length}`)
    for (const e of ofThisContact) {
      console.log('   -', {
        id: e.id,
        startTime: e.startTime,
        endTime: e.endTime,
        appointmentStatus: e.appointmentStatus,
        deleted: e.deleted,
        title: e.title,
      })
    }
  }
}

main().catch(err => { console.error(err); process.exit(1) })
