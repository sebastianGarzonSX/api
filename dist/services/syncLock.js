"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncLock = void 0;
// Cerrojo compartido entre el cron job y el endpoint POST /api/sync.
// Evita que dos ejecuciones corran en paralelo (doble carga, doble escritura).
let _running = false;
exports.syncLock = {
    get running() { return _running; },
    acquire() {
        if (_running)
            return false;
        _running = true;
        return true;
    },
    release() { _running = false; },
};
