import React from 'react';
import type { EventoPortonRow, TipoEvento } from '../types/porton';

interface EventHistoryProps {
  eventos: EventoPortonRow[];
  realtimeConnected: boolean;
}

function obtenerColorPunto(tipo: TipoEvento): string {
  switch (tipo) {
    case 'PORTON_CERRADO':
      return 'bg-emerald-400';
    case 'PORTON_ABIERTO':
      return 'bg-amber-400';
    case 'VALIDACION_IA':
      return 'bg-indigo-400';
    case 'ALERTA_TIEMPO':
    case 'CAMARA_MOVIDA':
    case 'CAMARA_DESCONECTADA':
      return 'bg-rose-400';
    default:
      return 'bg-slate-400';
  }
}

function formatearHoraEvento(isoDate: string): string {
  const fecha = new Date(isoDate);
  if (Number.isNaN(fecha.getTime())) return '--:-- hs';
  const hh = String(fecha.getHours()).padStart(2, '0');
  const mm = String(fecha.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} hs`;
}

export const EventHistory: React.FC<EventHistoryProps> = ({ eventos, realtimeConnected }) => {
  return (
    <section className="rounded-2xl bg-slate-800/60 border border-slate-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Actividad de Hoy
        </h3>
        <span
          className={`text-[11px] flex items-center gap-1 ${
            realtimeConnected ? 'text-emerald-400' : 'text-slate-400'
          }`}
        >
          <i className="fa-solid fa-bolt" /> Supabase Realtime
        </span>
      </div>

      {eventos.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400">
          No hay eventos registrados en el día de hoy.
        </div>
      ) : (
        <div className="space-y-3 text-xs">
          {eventos.map((ev, index) => {
            const esUltimo = index === eventos.length - 1;
            return (
              <div
                key={ev.id}
                className={`flex items-center justify-between py-1.5 ${
                  !esUltimo ? 'border-b border-slate-800/80' : ''
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${obtenerColorPunto(ev.tipo)}`}
                  />
                  <div>
                    <p className="font-semibold text-slate-200">{ev.titulo}</p>
                    <p className="text-[11px] text-slate-400">{ev.detalle}</p>
                  </div>
                </div>
                <span className="font-mono text-slate-400 shrink-0 ml-2">
                  {formatearHoraEvento(ev.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
