#!/bin/bash
# Arranque de producción — API Express (TypeScript compilado)
cd "$(dirname "$0")"

# Liberar el puerto si hay proceso previo
PORT=${PORT:-3001}
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  echo "[API] Matando proceso previo en puerto $PORT (PID: $PID)"
  kill -9 $PID 2>/dev/null
  sleep 1
fi

# Compilar TypeScript → dist/
echo "[API] Compilando TypeScript..."
npm run build
if [ $? -ne 0 ]; then
  echo "[API] ERROR: compilación fallida. Abortando."
  exit 1
fi

echo "[API] Iniciando servidor en puerto $PORT..."
exec node dist/index.js
