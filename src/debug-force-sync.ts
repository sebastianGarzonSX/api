import 'dotenv/config'
import { runSync } from './services/syncService.js'

console.log('Corriendo sync COMPLETO (force)...\n')

runSync(true)
  .then((r) => {
    console.log('\n========== RESULTADO ==========')
    console.log('Leads:', r.leads_upserted)
    console.log('Oportunidades:', r.opportunities_upserted)
    console.log('Pipelines:', r.pipelines_upserted)
    console.log('Meta:', r.meta_records_upserted)
    console.log('Errores:', r.errors.length)
    if (r.errors.length) r.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`))
    console.log('================================\n')
  })
  .catch((e) => console.error('Fatal:', e))
