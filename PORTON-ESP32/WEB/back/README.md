# Vigilante Frente — Backend FastAPI (`WEB/back`)

Backend intermediario para el sistema de monitoreo de portón corredizo **Edge-First + Cloud Backup**, diseñado según las reglas de [`AGENTS.md`](../../../AGENTS.md).

## Características
- **`POST /api/telemetria`** (Protegido con `x-api-key`):
  - Recibe las lecturas de las ROIs del ESP32 (`brillo_a`, `brillo_b`, `diff_porton`, `brillo_techo`, `brillo_rincon`, `es_de_dia`, `lecturas_consecutivas`).
  - **Temporizador Stateless de 10 minutos (`600s`):** Persiste `abierto_desde` en `public.estado_actual` y evalúa el tiempo transcurrido en cada pulso sin depender de `asyncio.sleep` en memoria.
  - **Juez de Última Instancia (Google Gemini 2.5 Flash):** Solo se invoca si `diff_porton` cae en la zona gris (`-30.0` a `-20.0`) al cambiar de estado, o para revalidar visualmente antes de disparar una alerta crítica (`>10 min abierto` o `CAMARA_MOVIDA`).
  - **Almacenamiento Cero-Crecimiento:** Sobrescribe siempre `ultima_captura.jpg` (`x-upsert: true`) en el bucket `capturas-porton`.
- **`POST /api/captura`** (Protegido con `x-api-key`):
  - Permite al ESP32 subir el buffer `jpgBuffer` (`image/jpeg`) en crudo sin sobrecargar el Heap con Base64 ni `String`.
- **`POST /api/consultar-ia`**:
  - Chat Visual interactivo desde la PWA familiar sobre `ultima_captura.jpg` usando **Gemini 2.5 Flash**.
- **`POST /api/push/suscribir`**:
  - Registra suscripciones **Web Push VAPID** de los navegadores familiares en `public.push_subscriptions`.
- **`GET /api/health`**:
  - Estado de salud y verificación de servicios.

## Ejecución Local

```bash
cd PORTON-ESP32/WEB/back
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
