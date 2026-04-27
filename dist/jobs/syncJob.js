"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSyncJob = startSyncJob;
const node_cron_1 = __importDefault(require("node-cron"));
const syncService_js_1 = require("../services/syncService.js");
const syncLock_js_1 = require("../services/syncLock.js");
// Default cada 30 min — el sync incremental es rápido y no necesita cada 15.
const SCHEDULE = process.env.SYNC_CRON_SCHEDULE ?? '*/30 * * * *';
function startSyncJob() {
    if (!node_cron_1.default.validate(SCHEDULE)) {
        console.error(`[SyncJob] Expresión cron inválida: "${SCHEDULE}". Job no iniciado.`);
        return;
    }
    node_cron_1.default.schedule(SCHEDULE, async () => {
        if (!syncLock_js_1.syncLock.acquire()) {
            console.log('[SyncJob] Sync ya en curso (cron o manual) — saltando.');
            return;
        }
        try {
            const result = await (0, syncService_js_1.runSync)();
            if (result.errors.length > 0) {
                console.error('[SyncJob] Errores:', result.errors);
            }
        }
        catch (err) {
            console.error('[SyncJob] Error inesperado:', err);
        }
        finally {
            syncLock_js_1.syncLock.release();
        }
    });
    console.log(`[SyncJob] Iniciado. Schedule: "${SCHEDULE}"`);
}
