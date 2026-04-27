import 'dotenv/config'
import { runSync } from './services/syncService.js'

console.log('Corriendo sync completo...\n')

runSync()
  .then((result) => {
    console.log('\n========== RESULTADO ==========')
    console.log('Leads upserted:         ', result.leads_upserted)
    console.log('Opportunities upserted: ', result.opportunities_upserted)
    console.log('Errores:                ', result.errors.length)
    if (result.errors.length > 0) {
      console.log('\nDetalle de errores:')
      result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`))
    }
    console.log('================================\n')
  })
  .catch((err) => {
    console.error('Error fatal en runSync:', err)
  })
