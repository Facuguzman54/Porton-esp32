export type EstadoPorton = 'CERRADO' | 'ABIERTO' | 'CAMARA_MOVIDA';

export type MetodoConfirmacion = 'ESP32_LOCAL' | 'JUEZ_IA';

export type RolUsuario = 'admin' | 'familiar' | string;

export interface UsuarioPerfil {
  id: string;
  username: string;
  nombre: string;
  rol: RolUsuario;
  activo?: boolean;
  ver_roi?: boolean;
  ver_estadisticas?: boolean;
  enviar_push?: boolean;
  auth_user_id?: string | null;
  ultimo_acceso?: string | null;
  created_at?: string | null;
}

export type UsuarioAutenticado = UsuarioPerfil;

export interface CrearUsuarioPayload {
  username: string;
  nombre: string;
  rol: 'admin' | 'familiar';
  password: string;
  activo?: boolean;
  ver_roi?: boolean;
  ver_estadisticas?: boolean;
  enviar_push?: boolean;
}

export interface ActualizarUsuarioPayload {
  nombre?: string;
  rol?: 'admin' | 'familiar';
  password?: string;
  activo?: boolean;
  ver_roi?: boolean;
  ver_estadisticas?: boolean;
  enviar_push?: boolean;
}

export interface ActualizarFuncionalidadesPayload {
  ver_roi?: boolean;
  ver_estadisticas?: boolean;
  enviar_push?: boolean;
}

export interface LoginResponse {
  ok: boolean;
  access_token: string;
  supabase_access_token?: string | null;
  supabase_refresh_token?: string | null;
  usuario: UsuarioPerfil;
}

export interface EstadoActualRow {
  id: number;
  estado: EstadoPorton;
  metodo_confirmacion: MetodoConfirmacion;
  lecturas_consecutivas: number;
  brillo_a: number;
  brillo_b: number;
  diff_porton: number;
  brillo_techo: number;
  brillo_rincon: number;
  es_de_dia: boolean;
  abierto_desde: string | null;
  alerta_enviada: boolean;
  ultima_captura_url: string | null;
  camara_online: boolean;
  updated_at: string;
}

export type TipoEvento =
  | 'PORTON_CERRADO'
  | 'PORTON_ABIERTO'
  | 'VALIDACION_IA'
  | 'ALERTA_TIEMPO'
  | 'CAMARA_MOVIDA'
  | 'CAMARA_DESCONECTADA'
  | 'AVISO_ADMIN';

export interface DispositivoPushSuscripto {
  id: string;
  etiqueta: string;
  user_agent: string;
  updated_at?: string | null;
}

export interface EnviarPushAdminResponse {
  ok: boolean;
  enviados_push: number;
  total_suscriptos: number;
  realtime_difundido: boolean;
  mensaje: string;
}

export interface EventoPortonRow {
  id: string | number;
  tipo: TipoEvento;
  titulo: string;
  detalle: string;
  duracion_segundos: number | null;
  duracion_seg?: number | null;
  estado?: string | null;
  metodo: MetodoConfirmacion;
  created_at: string;
}

export interface EstadoBackendResponse {
  ok: boolean;
  estado_actual: EstadoActualRow | null;
  eventos_hoy: EventoPortonRow[];
}

export interface EstadisticasDiarias {
  aperturasHoy: number;
  tiempoPromedioMin: number;
  alertasExcedidasHoy: number;
}

export interface ConsultaIaResponse {
  pregunta: string;
  respuesta: string;
  timestamp_captura: string;
  consultado_en: string;
}

/**
 * Especificaciones de Hardware y Calibración Empírica (INMUTABLE según AGENTS.md)
 * Resolución base del substream JPEG de la cámara IP XM530: 640x360 px
 */
export const CALIBRACION_CAMARA = {
  WIDTH: 640,
  HEIGHT: 360,
  UMBRAL_DIFF_PORTON: -25.0,
  UMBRAL_TECHO_DIA_MAX: 55.0,
  UMBRAL_TECHO_NOCHE_MIN: 130.0,
  TIEMPO_ALERTA_SEGUNDOS: 600, // 10 minutos
  ROIS: {
    ZONA_A: { x1: 335, y1: 95, x2: 382, y2: 175, label: 'Zona A (Pared)' },
    ZONA_B: { x1: 475, y1: 100, x2: 575, y2: 175, label: 'Zona B (Portón)' },
    ANCLA_TECHO: { x1: 15, y1: 5, x2: 130, y2: 45, label: 'Ancla Techo' },
    ANCLA_RINCON: { x1: 160, y1: 55, x2: 230, y2: 150, label: 'Ancla Rincón' },
  },
} as const;
