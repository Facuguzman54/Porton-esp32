import { useEffect, useMemo, useState } from 'react';
import { getStoredAccessToken, obtenerEstadoYEventosBackend } from '../lib/api';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type {
  EstadisticasDiarias,
  EstadoActualRow,
  EventoPortonRow,
} from '../types/porton';

const ESTADO_INICIAL_BASE: EstadoActualRow = {
  id: 1,
  estado: 'CERRADO',
  metodo_confirmacion: 'ESP32_LOCAL',
  lecturas_consecutivas: 3,
  brillo_a: 48.3,
  brillo_b: 27.6,
  diff_porton: 20.7,
  brillo_techo: 186,
  brillo_rincon: 92,
  es_de_dia: false,
  abierto_desde: null,
  alerta_enviada: false,
  ultima_captura_url: '/api/captura/ultima',
  camara_online: true,
  updated_at: new Date().toISOString(),
};

export function usePortonRealtime(autenticado: boolean) {
  const [estadoActual, setEstadoActual] = useState<EstadoActualRow>(ESTADO_INICIAL_BASE);
  const [eventosHoy, setEventosHoy] = useState<EventoPortonRow[]>([]);
  const [realtimeConnected, setRealtimeConnected] = useState<boolean>(false);
  const [avisoReciente, setAvisoReciente] = useState<EventoPortonRow | null>(null);

  useEffect(() => {
    if (!autenticado) {
      setRealtimeConnected(false);
      return;
    }

    let cancelado = false;
    const client = supabase;

    async function cargarDatosIniciales() {
      // 1. Intentar cargar desde `GET /api/estado` del backend FastAPI si hay token
      if (getStoredAccessToken()) {
        try {
          const resp = await obtenerEstadoYEventosBackend();
          if (!cancelado && resp.ok) {
            if (resp.estado_actual) {
              setEstadoActual(resp.estado_actual);
            }
            if (Array.isArray(resp.eventos_hoy)) {
              setEventosHoy(resp.eventos_hoy);
            }
            return;
          }
        } catch {
          // Si falla o el backend no está levantado, hacer fallback a consulta directa a Supabase
        }
      }

      if (!isSupabaseConfigured || !client) return;

      const { data: estadoData } = await client
        .from('estado_actual')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      if (!cancelado && estadoData) {
        setEstadoActual(estadoData as EstadoActualRow);
      }

      const inicioHoy = new Date();
      inicioHoy.setHours(0, 0, 0, 0);

      const { data: eventosData } = await client
        .from('eventos_porton')
        .select('*')
        .gte('created_at', inicioHoy.toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      if (!cancelado && eventosData) {
        setEventosHoy(eventosData as EventoPortonRow[]);
      }
    }

    cargarDatosIniciales();

    // 2. Suscripción Realtime a cambios de estado y nuevos eventos en Supabase
    if (!isSupabaseConfigured || !client) {
      return () => {
        cancelado = true;
      };
    }

    const channel = client
      .channel('porton-realtime-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'estado_actual' },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            setEstadoActual(payload.new as EstadoActualRow);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'eventos_porton' },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            const nuevoEvento = payload.new as EventoPortonRow;
            setEventosHoy((prev) => [
              nuevoEvento,
              ...prev.filter((e) => String(e.id) !== String(nuevoEvento.id)),
            ]);
            if (nuevoEvento.tipo === 'AVISO_ADMIN') {
              setAvisoReciente(nuevoEvento);
              if (
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted' &&
                'serviceWorker' in navigator
              ) {
                navigator.serviceWorker.ready
                  .then((reg) => {
                    reg.showNotification(nuevoEvento.titulo || '📢 Aviso de Admin', {
                      body: nuevoEvento.detalle,
                      icon: '/icon-192.svg',
                      badge: '/icon-192.svg',
                      tag: `aviso-rt-${nuevoEvento.id}`,
                    });
                  })
                  .catch(() => {});
              }
            }
          }
        }
      )
      .subscribe((status) => {
        if (!cancelado) {
          setRealtimeConnected(status === 'SUBSCRIBED');
        }
      });

    return () => {
      cancelado = true;
      client.removeChannel(channel);
    };
  }, [autenticado]);

  // Considerar el ESP32 online si la última actualización tiene menos de 35s y camara_online es true
  const esp32Online = useMemo(() => {
    if (!autenticado) return false;
    if (!estadoActual.camara_online) return false;
    const diffMs = Date.now() - new Date(estadoActual.updated_at).getTime();
    return diffMs < 35000;
  }, [autenticado, estadoActual]);

  // Calcular resumen diario a partir de los eventos del día (soportando duracion_segundos y duracion_seg)
  const estadisticas: EstadisticasDiarias = useMemo(() => {
    const aperturasHoy = eventosHoy.filter((e) => e.tipo === 'PORTON_ABIERTO').length;
    const cierresConDuracion = eventosHoy.filter((e) => {
      const seg = e.duracion_segundos ?? e.duracion_seg ?? 0;
      return e.tipo === 'PORTON_CERRADO' && typeof seg === 'number' && seg > 0;
    });

    const tiempoPromedioMin =
      cierresConDuracion.length > 0
        ? cierresConDuracion.reduce(
            (acc, ev) => acc + (ev.duracion_segundos ?? ev.duracion_seg ?? 0),
            0
          ) /
          cierresConDuracion.length /
          60
        : 0;

    const alertasExcedidasHoy = eventosHoy.filter((e) => e.tipo === 'ALERTA_TIEMPO').length;

    return {
      aperturasHoy,
      tiempoPromedioMin,
      alertasExcedidasHoy,
    };
  }, [eventosHoy]);

  return {
    estadoActual,
    eventosHoy,
    estadisticas,
    realtimeConnected,
    esp32Online,
    avisoReciente,
    cerrarAvisoReciente: () => setAvisoReciente(null),
  };
}
