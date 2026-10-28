import React, { useEffect, useState } from 'react';
import { getCapturaAutenticadaUrl } from '../lib/api';
import { CALIBRACION_CAMARA, type EstadoActualRow } from '../types/porton';

interface CameraViewerProps {
  estadoActual: EstadoActualRow;
}

function roiToPercentStyle(roi: { x1: number; y1: number; x2: number; y2: number }) {
  const left = (roi.x1 / CALIBRACION_CAMARA.WIDTH) * 100;
  const top = (roi.y1 / CALIBRACION_CAMARA.HEIGHT) * 100;
  const width = ((roi.x2 - roi.x1) / CALIBRACION_CAMARA.WIDTH) * 100;
  const height = ((roi.y2 - roi.y1) / CALIBRACION_CAMARA.HEIGHT) * 100;
  return {
    left: `${left.toFixed(2)}%`,
    top: `${top.toFixed(2)}%`,
    width: `${width.toFixed(2)}%`,
    height: `${height.toFixed(2)}%`,
  };
}

function formatearTimestampCaptura(isoDate: string | null): string {
  if (!isoDate) return '----/--/-- --:--:--';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '----/--/-- --:--:--';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

export const CameraViewer: React.FC<CameraViewerProps> = ({ estadoActual }) => {
  const [mostrarHud, setMostrarHud] = useState<boolean>(true);
  const [imgError, setImgError] = useState<boolean>(false);

  const imageUrl = getCapturaAutenticadaUrl(
    estadoActual.ultima_captura_url,
    estadoActual.updated_at
  );

  // Reintentar carga de imagen cada vez que llega una nueva marca temporal (updated_at)
  useEffect(() => {
    setImgError(false);
  }, [estadoActual.updated_at, estadoActual.ultima_captura_url]);

  const { brillo_a, brillo_b, diff_porton, brillo_techo, es_de_dia, estado } = estadoActual;
  const timestampFormateado = formatearTimestampCaptura(estadoActual.updated_at);
  const diffConSigno = `${diff_porton >= 0 ? '+' : ''}${diff_porton.toFixed(1)}`;
  const techoOk = estado !== 'CAMARA_MOVIDA';

  return (
    <section className="rounded-2xl bg-slate-800/60 border border-slate-800 overflow-hidden">
      {/* Barra superior del visor */}
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-slate-800">
        <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <i className="fa-solid fa-camera text-slate-400" /> Última imagen del ESP32
        </span>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400">{timestampFormateado}</span>
          <button
            type="button"
            onClick={() => setMostrarHud((prev) => !prev)}
            title={mostrarHud ? 'Ocultar HUD técnico de ROIs' : 'Mostrar HUD técnico de ROIs'}
            className={`px-2 py-0.5 rounded text-[10px] font-mono border transition cursor-pointer ${
              mostrarHud
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/25'
                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            <i className="fa-solid fa-vector-square mr-1" />
            ROIs
          </button>
        </div>
      </div>

      {/* Lienzo 16:9 (640x360) */}
      <div className="relative bg-black aspect-video flex items-center justify-center overflow-hidden select-none">
        {imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt="Última captura del portón (640x360)"
            onError={() => setImgError(true)}
            onLoad={() => setImgError(false)}
            className="w-full h-full object-cover"
          />
        ) : (
          /* Vista de fondo oscura estilo cámara XM530 cuando aún no se cargó imagen del bucket/RAM */
          <div className="w-full h-full bg-gradient-to-b from-neutral-800 via-neutral-900 to-neutral-950" />
        )}

        {/* Capa de metadatos OSD de la cámara (siempre visible como en el mockup) */}
        <div className="absolute inset-0 flex flex-col justify-between p-3 pointer-events-none">
          <div className="flex justify-between text-[11px] font-mono text-white/80">
            <span
              className={`px-1.5 py-0.5 rounded backdrop-blur-xs ${
                techoOk
                  ? 'bg-black/60 text-white/85'
                  : 'bg-rose-950/85 text-rose-200 border border-rose-500/50'
              }`}
            >
              Ancla Techo: {techoOk ? 'OK' : 'DESVIADA'} ({Math.round(brillo_techo)}) ·{' '}
              {es_de_dia ? 'Día' : 'Noche'}
            </span>
            <span className="bg-black/60 px-1.5 py-0.5 rounded backdrop-blur-xs">
              {timestampFormateado}
            </span>
          </div>

          <div className="flex justify-between items-end">
            <span className="text-xs font-mono font-bold text-white drop-shadow">
              vigilante frente
            </span>
            <span className="text-[11px] font-mono bg-slate-900/85 border border-slate-700 px-2 py-0.5 rounded text-slate-300">
              Diff: {diffConSigno}
            </span>
          </div>
        </div>

        {/* Superposición de ROIs calibradas a escala exacta 640x360 */}
        {mostrarHud && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Ancla Principal (Techo de Madera: X 15..130, Y 5..45) */}
            <div
              style={roiToPercentStyle(CALIBRACION_CAMARA.ROIS.ANCLA_TECHO)}
              className={`absolute border border-dashed rounded flex items-center justify-center text-[9px] font-mono ${
                techoOk
                  ? 'border-amber-400/60 bg-amber-500/10 text-amber-200'
                  : 'border-rose-400 bg-rose-500/25 text-rose-200'
              }`}
            >
              Techo {Math.round(brillo_techo)}
            </div>

            {/* Zona A (Pared de Referencia: X 335..382, Y 95..175) */}
            <div
              style={roiToPercentStyle(CALIBRACION_CAMARA.ROIS.ZONA_A)}
              className="absolute border border-dashed border-cyan-400/75 bg-cyan-500/15 rounded flex flex-col items-center justify-center text-[10px] leading-tight font-mono text-cyan-300 text-center shadow-xs"
            >
              <span>Zona A</span>
              <span className="font-bold">{brillo_a.toFixed(1)}</span>
            </div>

            {/* Zona B (Hoja del Portón: X 475..575, Y 100..175) */}
            <div
              style={roiToPercentStyle(CALIBRACION_CAMARA.ROIS.ZONA_B)}
              className="absolute border border-dashed border-emerald-400/75 bg-emerald-500/15 rounded flex flex-col items-center justify-center text-[10px] leading-tight font-mono text-emerald-300 text-center shadow-xs"
            >
              <span>Zona B (Portón)</span>
              <span className="font-bold">{brillo_b.toFixed(1)}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
