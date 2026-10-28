import React, { useEffect, useState } from 'react';
import { CALIBRACION_CAMARA, type EstadoActualRow } from '../types/porton';

interface StatusCardProps {
  estadoActual: EstadoActualRow;
}

function formatearMinutosSegundos(totalSegundos: number): string {
  const seg = Math.max(0, Math.floor(totalSegundos));
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatearHoraCorta(isoDate: string | null): string {
  if (!isoDate) return '--:--:--';
  const fecha = new Date(isoDate);
  if (Number.isNaN(fecha.getTime())) return '--:--:--';
  return fecha.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatearTiempoRelativo(isoDate: string | null, ahoraMs: number): string {
  if (!isoDate) return 'sin lecturas recientes';
  const fechaMs = new Date(isoDate).getTime();
  if (Number.isNaN(fechaMs)) return '';
  const diffSeg = Math.max(0, Math.floor((ahoraMs - fechaMs) / 1000));
  if (diffSeg < 60) return `hace ${diffSeg} seg`;
  const diffMin = Math.floor(diffSeg / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHoras = Math.floor(diffMin / 60);
  return `hace ${diffHoras} h`;
}

export const StatusCard: React.FC<StatusCardProps> = ({ estadoActual }) => {
  const [ahoraMs, setAhoraMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setAhoraMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const {
    estado,
    metodo_confirmacion,
    lecturas_consecutivas,
    abierto_desde,
    alerta_enviada,
    updated_at,
  } = estadoActual;

  const segundosAbierto =
    estado === 'ABIERTO' && abierto_desde
      ? Math.max(0, Math.floor((ahoraMs - new Date(abierto_desde).getTime()) / 1000))
      : 0;

  const limiteSeg =
    estadoActual.tiempo_alerta_segundos && estadoActual.tiempo_alerta_segundos >= 15
      ? estadoActual.tiempo_alerta_segundos
      : CALIBRACION_CAMARA.TIEMPO_ALERTA_SEGUNDOS;
  const etiquetaUmbral =
    limiteSeg >= 60 && limiteSeg % 60 === 0
      ? `${Math.floor(limiteSeg / 60)} min`
      : limiteSeg >= 60
      ? `${Math.floor(limiteSeg / 60)}m ${limiteSeg % 60}s`
      : `${limiteSeg} seg`;
  const tiempoExcedido =
    estado === 'ABIERTO' && (segundosAbierto >= limiteSeg || alerta_enviada);

  const porcentajeBarra = Math.min(100, Math.round((segundosAbierto / limiteSeg) * 100));

  // Configuración visual según el estado real
  let cardClass =
    'rounded-2xl p-5 bg-gradient-to-br from-emerald-950/90 to-slate-900 border border-emerald-500/40 shadow-lg transition-all duration-300';
  let badgeClass =
    'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
  let badgeIcon = metodo_confirmacion === 'JUEZ_IA' ? 'fa-wand-magic-sparkles' : 'fa-microchip';
  let badgeTexto =
    metodo_confirmacion === 'JUEZ_IA'
      ? 'Validado por Juez IA'
      : `Confirmado por ESP32 (${Math.min(lecturas_consecutivas || 3, 3)}/3)`;
  let titulo = 'PORTÓN CERRADO';
  let subtexto = `Última confirmación: Hoy, ${formatearHoraCorta(updated_at)} hs (${formatearTiempoRelativo(
    updated_at,
    ahoraMs
  )})`;
  let iconoContainerClass =
    'w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-2xl shrink-0';
  let iconoClass = 'fa-solid fa-lock';

  if (estado === 'CAMARA_MOVIDA') {
    cardClass =
      'rounded-2xl p-5 bg-gradient-to-br from-rose-950/95 to-slate-900 border-2 border-rose-500 shadow-lg transition-all duration-300';
    badgeClass =
      'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/30 text-rose-200 border border-rose-400/40';
    badgeIcon = 'fa-video-slash';
    badgeTexto = 'Ancla Techo fuera de rango';
    titulo = '¡CÁMARA MOVIDA!';
    subtexto = `Alerta de encuadre detectada (${formatearHoraCorta(updated_at)} hs)`;
    iconoContainerClass =
      'w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 text-2xl animate-bounce shrink-0';
    iconoClass = 'fa-solid fa-triangle-exclamation';
  } else if (estado === 'ABIERTO' && tiempoExcedido) {
    cardClass =
      'rounded-2xl p-5 bg-gradient-to-br from-rose-950/95 to-slate-900 border-2 border-rose-500 shadow-lg transition-all duration-300';
    badgeClass =
      'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/30 text-rose-200 border border-rose-400/40';
    badgeIcon = 'fa-wand-magic-sparkles';
    badgeTexto =
      metodo_confirmacion === 'JUEZ_IA' ? 'Revalidado por Juez IA' : 'Tiempo límite superado';
    titulo = `¡ALERTA: >${etiquetaUmbral.toUpperCase()}!`;
    subtexto = alerta_enviada
      ? `Notificación Push enviada al grupo familiar (${formatearHoraCorta(updated_at)} hs)`
      : `Abierto desde las ${formatearHoraCorta(abierto_desde)} hs`;
    iconoContainerClass =
      'w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 text-2xl animate-bounce shrink-0';
    iconoClass = 'fa-solid fa-triangle-exclamation';
  } else if (estado === 'ABIERTO') {
    cardClass =
      'rounded-2xl p-5 bg-gradient-to-br from-amber-950/90 to-slate-900 border border-amber-500/40 shadow-lg transition-all duration-300';
    badgeClass =
      'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30';
    badgeIcon = 'fa-clock';
    badgeTexto = 'Temporizador en curso';
    titulo = 'PORTÓN ABIERTO';
    subtexto = `Abierto desde las ${formatearHoraCorta(abierto_desde || updated_at)} hs`;
    iconoContainerClass =
      'w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 text-2xl shrink-0';
    iconoClass = 'fa-solid fa-lock-open';
  }

  return (
    <section id="card-estado" className={cardClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className={badgeClass}>
            <i className={`fa-solid ${badgeIcon}`} /> {badgeTexto}
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-white mt-2">{titulo}</h2>
          <p className="text-xs text-slate-300 mt-1">{subtexto}</p>
        </div>
        <div className={iconoContainerClass}>
          <i className={iconoClass} />
        </div>
      </div>

      {/* Barra de Temporizador configurable (Visible cuando el portón está ABIERTO) */}
      {estado === 'ABIERTO' && (
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="flex justify-between text-xs mb-1.5">
            <span className="text-amber-200 font-medium">
              <i className="fa-regular fa-clock mr-1" /> Temporizador de alerta ({etiquetaUmbral}):
            </span>
            <span className="font-mono font-bold text-white">
              {formatearMinutosSegundos(segundosAbierto)} / {formatearMinutosSegundos(limiteSeg)}
              {tiempoExcedido ? ' (Excedido)' : ''}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                tiempoExcedido ? 'bg-rose-500' : 'bg-amber-400'
              }`}
              style={{ width: `${tiempoExcedido ? 100 : porcentajeBarra}%` }}
            />
          </div>
        </div>
      )}
    </section>
  );
};
