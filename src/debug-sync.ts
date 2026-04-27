import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const GHL_BASE_URL = 'https://services.leadconnectorhq.com'
const API_KEY      = process.env.GHL_API_KEY!
const LOCATION_ID  = process.env.GHL_LOCATION_ID!
const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Version':       '2021-07-28',
  'Content-Type':  'application/json',
}

async function main() {
  console.log('\n========== DEBUG SYNC COMPLETO ==========\n')

  // ── 1. Fetch contactos (solo primera página) ──────────────────────────────
  console.log('--- PASO 1: Fetch contactos ---')
  const contactsUrl = `${GHL_BASE_URL}/contacts/?locationId=${LOCATION_ID}&limit=5`
  console.log('URL:', contactsUrl)

  const contactsRes = await fetch(contactsUrl, { headers })
  console.log('Status:', contactsRes.status)
  const contactsBody = await contactsRes.json()
  console.log('Estructura de respuesta:', Object.keys(contactsBody))
  console.log('meta:', contactsBody.meta)
  console.log('Primer contacto (raw):', JSON.stringify(contactsBody.contacts?.[0], null, 2))

  // ── 2. Intentar insertar un lead de prueba en Supabase ────────────────────
  console.log('\n--- PASO 2: Upsert de prueba en Supabase ---')
  const primerContacto = contactsBody.contacts?.[0]

  if (!primerContacto) {
    console.error('❌ No hay contactos en la respuesta. Revisar Location ID.')
    return
  }

  const leadPrueba = {
    ghl_contact_id: primerContacto.id,
    name:           primerContacto.name || primerContacto.firstName || 'Sin nombre',
    email:          primerContacto.email || null,
    phone:          primerContacto.phone || null,
    source:         primerContacto.source || null,
    stage:          'new' as const,
    updated_at:     new Date().toISOString(),
  }

  console.log('Lead a insertar:', leadPrueba)

  const { data, error } = await supabase
    .from('leads')
    .upsert(leadPrueba, { onConflict: 'ghl_contact_id' })
    .select()

  if (error) {
    console.error('❌ Error en upsert:', error)
  } else {
    console.log('✅ Upsert OK:', data)
  }

  // ── 3. Verificar cuántos registros hay en DB ───────────────────────────────
  console.log('\n--- PASO 3: Estado de la DB ---')
  const { count: leadsCount } = await supabase
    .from('leads').select('*', { count: 'exact', head: true })
  const { count: oppsCount } = await supabase
    .from('opportunities').select('*', { count: 'exact', head: true })

  console.log('Leads en DB:        ', leadsCount)
  console.log('Opportunities en DB:', oppsCount)

  console.log('\n=========================================\n')
}

main().catch(console.error)
