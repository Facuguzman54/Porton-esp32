import React, { useMemo, useState } from 'react';
import { eliminarEventoActividadAdmin } from '../lib/api';
import type { EventoPortonRow, TipoEvento } from '../types/porton';

interface EventHistoryProps {
  eventos: EventoPortonRow[];
  realtimeConnected: boolean;
  esAdmin?: boolean;
  onEliminarEvento?: (eventoId: string | number) => void;
}

function obtenerColorPunto(tipo: TipoEvento): string {
  switch (tipo) {
    case 'PORTON_CERRADO':
      return 'bg-emerald-400';
    case 'PORTON_ABIERTO':
      return 'bg-amber-400';
    case 'VALIDACION_IA':
      return 'bg-indigo-400';
    case 'AVISO_ADMIN':
      return 'bg-cyan-400';
    case 'ALERTA_TIEMPO':
    case 'CAMARA_MOVIDA':
    case 'CAMARA_DESCONECTADA':
      return 'bg-rose-400';
    default:
      return 'bg-slate-400';
  }
}

function formatearFechaHoraEvento(isoDate: string): string {
  const fecha = new Date(isoDate);
  if (Number.isNaN(fecha.getTime())) return '--:-- hs';
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mm = String(fecha.getMinutes()).padStart(2, '0');

  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();
  const inicioAyer = inicioHoy - 86400000;
  const tsEvento = fecha.getTime();

  if (tsEvento >= inicioHoy) {
    return `Hoy · ${hh}:${mm} hs`;
  }
  if (tsEvento >= inicioAyer) {
    return `Ayer · ${hh}:${mm} hs`;
  }
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mes} · ${hh}:${mm} hs`;
}

export const EventHistory: React.FC<EventHistoryProps> = ({
  eventos,
  realtimeConnected,
  esAdmin = false,
  onEliminarEvento,
}) => {
  const [filtroVentana, setFiltroVentana] = useState<'7d' | 'hoy'>('7d');
  const [eliminandoId, setEliminandoId] = useState<string | number | null>(null);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);

  const eventosFiltrados = useMemo(() => {
    if (filtroVentana === '7d') return eventos;
    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);
    const tsInicioHoy = inicioHoy.getTime();
    return eventos.filter((e) => {
      const ts = new Date(e.created_at).getTime();
      return !Number.isNaN(ts) && ts >= tsInicioHoy;
    });
  }, [eventos, filtroVentana]);

  const handleEliminar = async (ev: EventoPortonRow) => {
    if (!esAdmin || eliminandoId !== null) return;
    setEliminandoId(ev.id);
    setErrorEliminar(null);
    try {
      await eliminarEventoActividadAdmin(ev.id);
      if (onEliminarEvento) {
        onEliminarEvento(ev.id);
      }
    } catch (err) {
      setErrorEliminar(
        err instanceof Error ? err.message : 'No se pudo eliminar la notificación.'
      );
    } finally {
      setEliminandoId(null);
    }
  };

  return (
    <section className="rounded-2xl bg-slate-800/60 border border-slate-800 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Actividad Reciente
          </h3>
          <span
            className={`text-[10px] flex items-center gap-1 mt-0.5 ${
              realtimeConnected ? 'text-emerald-400' : 'text-slate-400'
            }`}
          >
            <i className="fa-solid fa-bolt" /> Supabase Realtime
          </span>
        </div>

        {/* Selector Hoy vs Últimos 7 días */}
        <div className="flex items-center bg-slate-900/90 border border-slate-700/80 rounded-xl p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setFiltroVentana('7d')}
            className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
              filtroVentana === '7d'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Últimos 7 días ({eventos.length})
          </button>
          <button
            type="button"
            onClick={() => setFiltroVentana('hoy')}
            className={`px-2.5 py-1 rounded-lg font-semibold transition cursor-pointer ${
              filtroVentana === 'hoy'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Hoy
          </button>
        </div>
      </div>

      {errorEliminar && (
        <div className="mb-2.5 px-3 py-1.5 rounded-lg bg-rose-950/80 border border-rose-500/40 text-[11px] text-rose-200 flex items-center justify-between">
          <span>{errorEliminar}</span>
          <button
            type="button"
            onClick={() => setErrorEliminar(null)}
            className="text-rose-300 hover:text-white ml-2"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      )}

      {eventosFiltrados.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">
          {filtroVentana === 'hoy'
            ? 'No hay eventos registrados en el día de hoy.'
            : 'No hay eventos registrados en los últimos 7 días.'}
        </div>
      ) : (
        <div className="space-y-2.5 text-xs max-h-80 overflow-y-auto pr-1">
          {eventosFiltrados.map((ev, index) => {
            const esUltimo = index === eventosFiltrados.length - 1;
            const borrando = eliminandoId === ev.id;
            return (
              <div
                key={ev.id}
                className={`flex items-center justify-between gap-2 py-1.5 ${
                  !esUltimo ? 'border-b border-slate-800/80' : ''
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${obtenerColorPunto(ev.tipo)}`}
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-200 truncate">{ev.titulo}</p>
                    <p className="text-[11px] text-slate-400 break-words">{ev.detalle}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 ml-1">
                  <span className="font-mono text-[11px] text-slate-400">
                    {formatearFechaHoraEvento(ev.created_at)}
                  </span>
                  {esAdmin && (
                    <button
                      type="button"
                      disabled={borrando}
                      onClick={() => handleEliminar(ev)}
                      title="Eliminar notificación / falsa alarma"
                      className="w-6 h-6 rounded-lg bg-slate-900/80 hover:bg-rose-950 border border-slate-700/80 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 flex items-center justify-center text-[11px] transition cursor-pointer"
                    >
                      <i
                        className={`fa-solid ${
                          borrando ? 'fa-circle-notch fa-spin' : 'fa-trash-can'
                        }`}
                      />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
