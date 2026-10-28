# ==============================================================================
# Stage 1: Compilar la PWA Familiar (React + Vite + Tailwind)
# ==============================================================================
FROM node:22-alpine AS frontend-builder

WORKDIR /front

COPY PORTON-ESP32/WEB/front/package*.json ./
RUN npm ci

COPY PORTON-ESP32/WEB/front/ ./

# Variables públicas embebidas en el bundle de Vite para Supabase Realtime y Web Push VAPID
ARG VITE_SUPABASE_URL=https://sseonoxhacutaxchbgmj.supabase.co
ARG VITE_SUPABASE_ANON_KEY=sb_publishable_ZTaEw1TC99ltxKBiyb3WJg_t4JNDO-O
ARG VITE_SUPABASE_BUCKET=capturas-porton
ARG VITE_VAPID_PUBLIC_KEY=BKyhK8sJIZT94vOqSbi2IfvpkMpw5HMclxEQaeY5IB2yFAo_t5UVAvuCImLqA6RCfNQIg1e556AJMDtkaBw7zZU
ARG VITE_API_BASE_URL=

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_SUPABASE_BUCKET=$VITE_SUPABASE_BUCKET \
    VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY \
    VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ==============================================================================
# Stage 2: Imagen de Producción Todo-en-Uno (FastAPI + PWA Estática)
# ==============================================================================
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

COPY PORTON-ESP32/WEB/back/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY PORTON-ESP32/WEB/back/app ./app
COPY --from=frontend-builder /front/dist ./static

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
