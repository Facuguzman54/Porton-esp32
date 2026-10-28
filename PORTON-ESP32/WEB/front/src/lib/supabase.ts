import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const SUPABASE_BUCKET =
  (import.meta.env.VITE_SUPABASE_BUCKET as string | undefined) || 'capturas-porton';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('tu-proyecto.supabase.co') &&
    supabaseAnonKey !== 'tu-anon-key-publica'
);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      realtime: {
        params: {
          eventsPerSecond: 5,
        },
      },
    })
  : null;

/**
 * Construye la URL autenticada de `ultima_captura.jpg` servida desde la caché en RAM
 * del backend FastAPI (`/api/captura/ultima`) con cache-busting y JWT del usuario familiar.
 */
export function getUltimaCapturaPublicUrl(
  customUrl: string | null | undefined,
  updatedAtIso: string | null | undefined
): string | null {
  const cacheBuster = updatedAtIso ? new Date(updatedAtIso).getTime() : Date.now();
  const token =
    typeof window !== 'undefined' ? window.localStorage.getItem('vf_access_token') : null;

  const isLocalHost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const configuredBase = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '')
    .trim()
    .replace(/\/+$/, '');
  const apiBase =
    !isLocalHost && (!configuredBase || configuredBase.includes('localhost'))
      ? ''
      : configuredBase || (isLocalHost ? 'http://localhost:8000' : '');

  // Siempre preferir el endpoint en RAM del backend si el usuario tiene sesión activa
  if (token) {
    return `${apiBase}/api/captura/ultima?token=${encodeURIComponent(token)}&t=${cacheBuster}`;
  }

  if (customUrl && customUrl.startsWith('http')) {
    const separator = customUrl.includes('?') ? '&' : '?';
    return `${customUrl}${separator}t=${cacheBuster}`;
  }

  return null;
}
