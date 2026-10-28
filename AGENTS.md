# AGENTS.md — Sistema Inteligente de Monitoreo de Portón ("Vigilante Frente")

Este documento es la **fuente de verdad arquitectónica y operativa** para cualquier agente de IA o desarrollador que trabaje en el repositorio. Contiene el contexto de hardware, las coordenadas calibradas empíricamente, las reglas de negocio, el esquema de datos y las restricciones de diseño que **no deben romperse**.

---

## 1. Visión General del Proyecto
Sistema doméstico de monitoreo en tiempo real para un portón corredizo, diseñado bajo una arquitectura **Edge-First + Cloud Backup**:
1. **Procesamiento en el Borde (ESP32):** Captura imágenes JPEG cada 5 segundos de una cámara IP local, decodifica en memoria RAM únicamente las Regiones de Interés (ROI) y determina el estado (`CERRADO`, `ABIERTO`, `CAMARA_MOVIDA`) sin costo de nube.
2. **Backend Intermediario (Python FastAPI):** Centraliza la lógica de eventos, gestiona el temporizador *stateless* de 10 minutos, almacena estados en Supabase, envía notificaciones Web Push y actúa como puente seguro hacia la IA.
3. **Visión Artificial en la Nube (Google Gemini Flash):** Actúa exclusivamente en dos escenarios:
   * **Juez de Última Instancia:** Cuando el ESP32 reporta lecturas en zona de incertidumbre o antes de disparar una alerta crítica.
   * **Asistente Visual Interactivo:** Cuando un usuario autorizado realiza una consulta en lenguaje natural desde la PWA sobre la última captura disponible.
4. **Persistencia y Tiempo Real (Supabase):** PostgreSQL + Realtime + Storage (con política estricta de sobrescritura para no superar la capa gratuita) + Auth.
5. **Frontend Familiar (PWA Mobile-First):** Interfaz instalable en celulares y PC con estado en vivo, historial diario, asistente visual y suscripción a notificaciones Web Push (VAPID).

---

## 2. Arquitectura del Sistema y Flujo de Datos

```text
[Cámara IP XM530] (192.168.0.166 - Substream 640x360 JPEG)
       │
       ▼ (HTTP GET cada 5s en LAN)
[ESP32 Edge Node] (C++ / PlatformIO / TJpg_Decoder + NTP Time)
       │  ├─ Evalúa Ancla de Posición según horario solar (Día/Noche)
       │  ├─ Evalúa Diferencial de Brillo: Zona A (Pared) vs Zona B (Portón)
       │  └─ Aplica filtro anti-rebote (3 lecturas consecutivas = 15s)
       ▼ (HTTP POST a /api/telemetria con x-api-key)
[Backend Python FastAPI] (Local / Render / Koyeb)
       ├──► [Supabase PostgreSQL & Storage] (Estado actual, Historial 90d, ultima_captura.jpg)
       ├──► [Google Gemini 2.5 Flash API] (Juez de casos dudosos + Consultas manuales PWA)
       └──► [Servicio Web Push VAPID] (Alertas por >10 min abierto o cámara desviada)
                 │
                 ▼
       [PWA Familiar (React + Vite + Tailwind)] (Realtime UI + Chat Visual IA)
```

---

## 3. Especificaciones de Hardware y Calibración Empírica (INMUTABLE)

> **REGLA CRÍTICA:** No modificar las coordenadas de las ROIs ni los umbrales de brillo en [`main.cpp`](PORTON-ESP32/src/main.cpp) sin solicitud explícita del usuario. Están calibrados sobre el encuadre real de la cámara `XM530` a `640x360` px.

### 3.1. Parámetros de Red y Cámara
* **IP Cámara Local:** `192.168.0.166`
* **Endpoint de Captura:** `http://192.168.0.166/webcapture.jpg?command=snap&channel=1&user=...&password=...`
* **Resolución de Captura:** `640x360` píxeles (Substream JPEG).
* **Frecuencia de Muestreo:** Cada `5000 ms` (5 segundos).
* **Sincronización Horaria:** NTP (`pool.ntp.org`), zona horaria Argentina (`UTC-3`, `gmtOffset_sec = -10800`, `daylightOffset_sec = 0`).
  * **Horario Diurno:** `07:00` a `19:59` hs (`horaActual >= 7 && horaActual < 20`).
  * **Horario Nocturno:** `20:00` a `06:59` hs.

### 3.2. Regiones de Interés (ROIs) en `640x360`
1. **Zona A (Pared de Referencia - Izquierda):**
   * `X1 = 335`, `Y1 = 95`, `X2 = 382`, `Y2 = 175`
2. **Zona B (Hoja del Portón - Derecha):**
   * `X1 = 475`, `Y1 = 100`, `X2 = 575`, `Y2 = 175`
   * *Nota de calibración:* Elevadas en el eje Y (`95` a `175`) para evitar falsos positivos cuando un vehículo se estaciona frente al portón.
3. **Ancla de Posición Principal (Techo de Madera):**
   * `X1 = 15`, `Y1 = 5`, `X2 = 130`, `Y2 = 45`
4. **Ancla Secundaria (Rincón):**
   * `X1 = 160`, `Y1 = 55`, `X2 = 230`, `Y2 = 150`

### 3.3. Algoritmo de Decisión en el Borde (ESP32)
* **Conversión a Escala de Grises (RGB565 a 8-bit):**
  * Extracción desde callback de `TJpg_Decoder`: `gris = (r + g + b) / 3`.
* **Detección de Cámara Fuera de Posición (`CAMARA_MOVIDA`):**
  * **De Día (`07:00 - 19:59`):** El techo de madera es oscuro (`brilloTecho <= 55.0`). Si `brilloTecho > 55.0`, se marca `camaraDesviada = true`.
  * **De Noche (`20:00 - 06:59`):** El LED infrarrojo ilumina fuertemente el techo cercano (`brilloTecho >= 130.0`). Si `brilloTecho < 130.0`, se marca `camaraDesviada = true`.
* **Evaluación del Portón (`diffPorton = brilloA - brilloB`):**
  * **Umbral (`UMBRAL_DIFF_PORTON`):** `-25.0`
  * Si `diffPorton > -25.0` ➔ `CERRADO`
  * Si `diffPorton <= -25.0` ➔ `ABIERTO`
* **Filtro Anti-Rebote (Debounce):**
  * Se requieren **3 lecturas consecutivas idénticas** (`15 segundos`) para cambiar el `estadoConfirmado`.
* **Fallo de Conexión de Cámara:**
  * Se dispara alerta de desconexión tras **6 fallos HTTP consecutivos** (`30 segundos`).

---

## 4. Reglas de Negocio del Backend (FastAPI) y Cloud

1. **Autenticación Dispositivo-Backend:**
   * El ESP32 envía telemetría mediante `POST /api/telemetria` incluyendo el header `x-api-key`.
2. **Política de Almacenamiento Cero-Crecimiento (Supabase Storage):**
   * **SIEMPRE sobrescribir el mismo archivo** (`ultima_captura.jpg` con `upsert=true`). No acumular imágenes históricas en el bucket para garantizar permanencia perpetua en el Free Tier de Supabase.
3. **Temporizador Stateless de 10 Minutos:**
   * El backend no debe depender de `asyncio.sleep(600)` en memoria que muera si el contenedor se reinicia. Debe registrar `abierto_desde` en la base de datos y evaluar en cada pulso de telemetría (o cron ligero) si el tiempo transcurrido supera los **10 minutos (`600 segundos`)** sin haberse enviado `alerta_enviada = true`.
4. **Uso Racional de Gemini 2.5 Flash (Cuota Gratuita):**
   * **NO invocar a Gemini en cada frame de 5s.**
   * Llamar a Gemini únicamente cuando:
     1. El diferencial `diffPorton` caiga en una **zona gris de incertidumbre** (ej. entre `-20.0` y `-30.0`) al intentar cambiar de estado.
     2. Se esté por disparar una **alerta crítica** (`>10 min abierto` o `CAMARA_MOVIDA`) para revalidar visualmente y evitar falsas alarmas a la familia.
     3. El usuario lo solicite manualmente desde el **Chat Visual de la PWA** (`POST /api/consultar-ia`).
5. **Retención de Historial:**
   * Mantener eventos en PostgreSQL por un máximo de **90 días** (limpieza automática o programada).

---

## 5. Estructura del Repositorio

```text
PORTON-ESP32/
├── AGENTS.md                        # Este archivo (Fuente de verdad para agentes)
├── sketch.c                         # Prototipo inicial (Etapa 1)
└── PORTON-ESP32/
    ├── platformio.ini               # Configuración PlatformIO (esp32dev + TJpg_Decoder)
    ├── src/
    │   └── main.cpp                 # Firmware principal del nodo Edge ESP32
    └── WEB/
        ├── front/
        │   └── mockup_porton.html   # Mockup de referencia UI/UX (Tailwind Dark Mode)
        └── back/                    # (Por implementar) Backend FastAPI + Supabase + Gemini
```

---

## 6. Directrices de Desarrollo y Estilo de Código

* **C++ / ESP32 (`main.cpp`):**
  * Prohibido usar `String` dinámico pesado dentro del callback `analizarBloqueJpg`. Mantener operaciones con enteros (`uint16_t`, `uint32_t`).
  * Liberar siempre el buffer JPEG con `free(jpgBuffer)` inmediatamente después de `TJpgDec.drawJpg(...)` para evitar fragmentación de Heap o *Out of Memory*.
  * Externalizar credenciales WiFi, cámara y API Keys en un archivo `include/secrets.h` (ignorado en `.gitignore`) antes de subir a repositorios públicos.
* **Python / FastAPI:**
  * Usar tipado estricto con **Pydantic v2** para los payloads de telemetría y respuestas de IA.
  * Manejar timeouts de red al consultar a Gemini o Supabase para no bloquear el *ack* hacia el ESP32.
* **Frontend / PWA:**
  * Respetar fielmente el diseño oscuro (*Dark Mode* en `slate-900`/`slate-950`) y los 5 módulos definidos en [`mockup_porton.html`](PORTON-ESP32/WEB/front/mockup_porton.html):
    1. Tarjeta de Estado Actual (`emerald` = Cerrado, `amber` = Abierto con barra de 10 min, `rose` = Alerta >10m).
    2. Visor de Última Captura con metadatos de ROIs.
    3. Asistente Visual IA Interactivo con chips de preguntas rápidas.
    4. Resumen Diario (Aperturas hoy, Tiempo prom., Alertas >10m).
    5. Historial de Eventos en Tiempo Real (Supabase Realtime).
