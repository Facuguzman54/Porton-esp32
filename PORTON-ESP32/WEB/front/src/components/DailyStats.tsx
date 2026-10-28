import React from 'react';
import type { EstadisticasDiarias } from '../types/porton';

interface DailyStatsProps {
  estadisticas: EstadisticasDiarias;
  tiempoAlertaSegundos?: number;
}

export const DailyStats: React.FC<DailyStatsProps> = ({
  estadisticas,
  tiempoAlertaSegundos = 600,
}) => {
  const { aperturasHoy, tiempoPromedioMin, alertasExcedidasHoy } = estadisticas;
  const etiquetaCorta =
    tiempoAlertaSegundos >= 60 && tiempoAlertaSegundos % 60 === 0
      ? `${Math.floor(tiempoAlertaSegundos / 60)}m`
      : `${tiempoAlertaSegundos}s`;

  return (
    <section className="grid grid-cols-3 gap-2.5">
      <div className="bg-slate-800/50 border border-slate-800 rounded-xl p-3 text-center">
        <p className="text-[11px] text-slate-400">Aperturas hoy</p>
        <p className="text-xl font-bold text-white mt-0.5">{aperturasHoy}</p>
      </div>

      <div className="bg-slate-800/50 border border-slate-800 rounded-xl p-3 text-center">
        <p className="text-[11px] text-slate-400">Tiempo prom.</p>
        <p className="text-xl font-bold text-white mt-0.5">
          {tiempoPromedioMin.toFixed(1)}{' '}
          <span className="text-xs font-normal text-slate-400">min</span>
        </p>
      </div>

      <div className="bg-slate-800/50 border border-slate-800 rounded-xl p-3 text-center">
        <p className="text-[11px] text-slate-400">Alertas (&gt;{etiquetaCorta})</p>
        <p
          className={`text-xl font-bold mt-0.5 ${
            alertasExcedidasHoy > 0 ? 'text-rose-400' : 'text-emerald-400'
          }`}
        >
          {alertasExcedidasHoy}
        </p>
      </div>
    </section>
  );
};
