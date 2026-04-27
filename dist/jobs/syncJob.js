"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSyncJob = startSyncJob;
const node_cron_1 = __importDefault(require("node-cron"));
const syncService_js_1 = require("../services/syncService.js");
// Expresión cron configurable vía env. Default: cada 15 minutos.
const SCHEDULE = process.env.SYNC_CRON_SCHEDULE ?? '*/15 * * * *';
let isRunning = false;
/**
 * Inicia el job de sincronización periódica con GoHighLevel.
 * Protegido contra ejecuciones concurrentes (isRunning flag).
 */
function startSyncJob() {
    if (!node_cron_1.default.validate(SCHEDULE)) {
        console.error(`[SyncJob] Expresión cron inválida: "${SCHEDULE}". Job no iniciado.`);
        return;
    }
    node_cron_1.default.schedule(SCHEDULE, async () => {
        if (isRunning) {
            console.log('[SyncJob] Sync ya en curso — saltando ejecución.');
            return;
        }
        isRunning = true;
        try {
            const result = await (0, syncService_js_1.runSync)();
            if (result.errors.length > 0) {
                console.error('[SyncJob] Errores durante sync:', result.errors);
            }
        }
        catch (err) {
            console.error('[SyncJob] Error inesperado:', err);
        }
        finally {
            isRunning = false;
        }
    });
    console.log(`[SyncJob] Iniciado. Schedule: "${SCHEDULE}"`);
}
