import type {
  ActualizarUsuarioPayload,
  ConsultaIaResponse,
  CrearUsuarioPayload,
  DispositivoPushSuscripto,
  EnviarPushAdminResponse,
  EstadoBackendResponse,
  LoginResponse,
  UsuarioPerfil,
} from '../types/porton';
import { getUltimaCapturaPublicUrl } from './supabase';

const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
export const API_BASE_URL = RAW_API_BASE.replace(/\/+$/, '');

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || '';

const ACCESS_TOKEN_STORAGE_KEY = 'vf_access_token';

export function getStoredAccessToken(): string | null {
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredAccessToken(token: string): void {
  try {
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage errors in restricted contexts
  }
}

export function clearStoredAccessToken(): void {
  try {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

function buildAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getStoredAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function parseErrorMessage(response: Response, fallbackMsg: string): Promise<string> {
  try {
    const data = await response.json();
    if (data && typeof data.detail === 'string') {
      return data.detail;
    }
  } catch {
    // Ignore JSON parse error
  }
  return fallbackMsg;
}

/**
 * Autentica un usuario contra `POST /api/auth/login` en el backend FastAPI
 * (que verifica `public.usuarios` con bcrypt y sincroniza sesión con Supabase Auth).
 */
export async function loginConBackend(
  username: string,
  password: string
): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username: username.trim(), password }),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(
      response,
      'Usuario o contraseña incorrectos, o cuenta deshabilitada.'
    );
    throw new Error(msg);
  }

  return (await response.json()) as LoginResponse;
}

export const iniciarSesion = loginConBackend;

/**
 * Valida el token JWT actual contra `GET /api/auth/me` en el backend FastAPI.
 */
export async function obtenerSesionActualBackend(): Promise<UsuarioPerfil> {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    method: 'GET',
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(response, 'Sesión expirada o inválida.');
    throw new Error(msg);
  }

  return (await response.json()) as UsuarioPerfil;
}

/**
 * Permite al usuario autenticado (ej. admin) cambiar su propia contraseña
 * validando primero su contraseña actual (`POST /api/auth/cambiar-password`).
 */
export async function cambiarMiPassword(
  passwordActualOrObj: string | { password_actual: string; password_nueva: string },
  passwordNuevaArg?: string
): Promise<{ ok: boolean; mensaje: string }> {
  const bodyPayload =
    typeof passwordActualOrObj === 'string'
      ? {
          password_actual: passwordActualOrObj,
          password_nueva: passwordNuevaArg || '',
        }
      : passwordActualOrObj;

  const response = await fetch(`${API_BASE_URL}/api/auth/cambiar-password`, {
    method: 'POST',
    headers: buildAuthHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(bodyPayload),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(
      response,
      'No se pudo actualizar la contraseña. Verificá tu contraseña actual.'
    );
    throw new Error(msg);
  }

  return (await response.json()) as { ok: boolean; mensaje: string };
}

/**
 * Lista todos los usuarios registrados en `public.usuarios` (Exclusivo rol `admin`).
 */
export async function listarUsuariosAdmin(): Promise<UsuarioPerfil[]> {
  const response = await fetch(`${API_BASE_URL}/api/usuarios`, {
    method: 'GET',
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(response, 'No se pudo cargar la lista de usuarios.');
    throw new Error(msg);
  }

  return (await response.json()) as UsuarioPerfil[];
}

/**
 * Crea un nuevo usuario familiar o admin en `public.usuarios` (Exclusivo rol `admin`).
 */
export async function crearUsuarioAdmin(payload: CrearUsuarioPayload): Promise<UsuarioPerfil> {
  const response = await fetch(`${API_BASE_URL}/api/usuarios`, {
    method: 'POST',
    headers: buildAuthHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(response, 'No se pudo crear el usuario.');
    throw new Error(msg);
  }

  return (await response.json()) as UsuarioPerfil;
}

/**
 * Actualiza datos, rol, estado activo o contraseña de un usuario (Exclusivo rol `admin`).
 */
export async function actualizarUsuarioAdmin(
  usuarioId: string,
  payload: ActualizarUsuarioPayload
): Promise<UsuarioPerfil> {
  const response = await fetch(`${API_BASE_URL}/api/usuarios/${encodeURIComponent(usuarioId)}`, {
    method: 'PATCH',
    headers: buildAuthHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(response, 'No se pudo actualizar el usuario.');
    throw new Error(msg);
  }

  return (await response.json()) as UsuarioPerfil;
}

/**
 * Elimina un usuario de `public.usuarios` (Exclusivo rol `admin`).
 */
export async function eliminarUsuarioAdmin(
  usuarioId: string
): Promise<{ ok: boolean; mensaje: string }> {
  const response = await fetch(`${API_BASE_URL}/api/usuarios/${encodeURIComponent(usuarioId)}`, {
    method: 'DELETE',
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(response, 'No se pudo eliminar el usuario.');
    throw new Error(msg);
  }

  return (await response.json()) as { ok: boolean; mensaje: string };
}

/**
 * Obtiene `{ estado_actual, eventos_hoy }` desde `GET /api/estado` (requiere Bearer token).
 */
export async function obtenerEstadoYEventosBackend(): Promise<EstadoBackendResponse> {
  const response = await fetch(`${API_BASE_URL}/api/estado`, {
    method: 'GET',
    headers: buildAuthHeaders(),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(
      response,
      `Error al obtener estado actual (${response.status}).`
    );
    throw new Error(msg);
  }

  return (await response.json()) as EstadoBackendResponse;
}

/**
 * Construye la URL autenticada de la última captura JPEG (`GET /api/captura/ultima?token=...&t=...`)
 * servida desde la caché en RAM del backend FastAPI, con fallback a Supabase Storage.
 */
export function getCapturaAutenticadaUrl(
  customUrl: string | null | undefined,
  updatedAtIso: string | null | undefined
): string | null {
  const cacheBuster = updatedAtIso ? new Date(updatedAtIso).getTime() : Date.now();
  const token = getStoredAccessToken();

  const usaEndpointBackend =
    !customUrl || customUrl.startsWith('/api/') || customUrl.includes('/api/captura/ultima');

  if (usaEndpointBackend && token) {
    const basePath =
      customUrl && customUrl.startsWith('http')
        ? customUrl
        : `${API_BASE_URL}${customUrl && customUrl.startsWith('/api/') ? customUrl : '/api/captura/ultima'}`;
    const sep = basePath.includes('?') ? '&' : '?';
    return `${basePath}${sep}token=${encodeURIComponent(token)}&t=${cacheBuster}`;
  }

  return getUltimaCapturaPublicUrl(customUrl, updatedAtIso);
}

/**
 * Envía una consulta en lenguaje natural sobre `ultima_captura.jpg` al backend FastAPI,
 * que invoca a Google Gemini 2.5 Flash bajo demanda (`POST /api/consultar-ia` con Bearer token).
 */
export async function consultarAsistenteVisual(pregunta: string): Promise<ConsultaIaResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(new Error('Tiempo de espera agotado al consultar la IA (30s).')),
    30000
  );

  try {
    const response = await fetch(`${API_BASE_URL}/api/consultar-ia`, {
      method: 'POST',
      headers: buildAuthHeaders({
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ pregunta }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const msg = await parseErrorMessage(
        response,
        `Error del servidor (${response.status}) al consultar a Gemini Flash.`
      );
      throw new Error(msg);
    }

    return (await response.json()) as ConsultaIaResponse;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Tiempo de espera agotado al consultar la IA (30s).');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Registra el Service Worker y suscribe el navegador a notificaciones Web Push VAPID
 * enviando la suscripción autenticada a `POST /api/push/suscribir`.
 */
export async function suscribirNotificacionesPush(): Promise<{
  ok: boolean;
  mensaje: string;
}> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return {
      ok: false,
      mensaje: 'Tu navegador no soporta notificaciones Web Push.',
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      ok: false,
      mensaje: 'Permiso de notificaciones denegado en el navegador.',
    };
  }

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  if (!VAPID_PUBLIC_KEY) {
    return {
      ok: false,
      mensaje: 'Falta configurar VITE_VAPID_PUBLIC_KEY en las variables de entorno.',
    };
  }

  const existingSub = await registration.pushManager.getSubscription();
  const subscription =
    existingSub ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    }));

  const response = await fetch(`${API_BASE_URL}/api/push/suscribir`, {
    method: 'POST',
    headers: buildAuthHeaders({
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(
      response,
      `No se pudo registrar la suscripción en el backend (${response.status}).`
    );
    throw new Error(msg);
  }

  return {
    ok: true,
    mensaje: 'Notificaciones Push activadas en este dispositivo.',
  };
}

export async function verificarEstadoPushInicial(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let sub = await registration.pushManager.getSubscription();
    if (!sub && VAPID_PUBLIC_KEY) {
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }
    if (sub && getStoredAccessToken()) {
      fetch(`${API_BASE_URL}/api/push/suscribir`, {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(sub.toJSON()),
      }).catch(() => {});
    }
    return Boolean(sub);
  } catch {
    return false;
  }
}

export async function listarSuscripcionesPushAdmin(): Promise<{
  total: number;
  dispositivos: DispositivoPushSuscripto[];
}> {
  const response = await fetch(`${API_BASE_URL}/api/push/suscripciones`, {
    method: 'GET',
    headers: buildAuthHeaders({ Accept: 'application/json' }),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(
      response,
      `No se pudieron consultar los dispositivos Push (${response.status}).`
    );
    throw new Error(msg);
  }

  const data = (await response.json()) as {
    ok: boolean;
    total: number;
    dispositivos: DispositivoPushSuscripto[];
  };
  return {
    total: data.total ?? 0,
    dispositivos: Array.isArray(data.dispositivos) ? data.dispositivos : [],
  };
}

export async function enviarNotificacionPushAdmin(payload: {
  titulo: string;
  mensaje: string;
  registrar_en_actividad?: boolean;
}): Promise<EnviarPushAdminResponse> {
  const response = await fetch(`${API_BASE_URL}/api/push/enviar`, {
    method: 'POST',
    headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const msg = await parseErrorMessage(
      response,
      `No se pudo enviar la notificación Push (${response.status}).`
    );
    throw new Error(msg);
  }

  return (await response.json()) as EnviarPushAdminResponse;
}
