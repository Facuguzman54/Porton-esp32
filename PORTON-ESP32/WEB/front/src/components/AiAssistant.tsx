import React, { useState } from 'react';
import { consultarAsistenteVisual } from '../lib/api';

interface AiAssistantProps {
  ultimaCapturaIso: string | null;
}

const CHIPS_PREGUNTAS = [
  { label: '🚗 ¿Está el auto?', pregunta: '¿Se ve el auto estacionado?' },
  { label: '🐕 ¿Se ven mascotas?', pregunta: '¿Hay alguna mascota cerca del portón?' },
  {
    label: '📦 ¿Algo en la entrada?',
    pregunta: '¿Hay algún objeto extraño afuera o trabando el riel?',
  },
] as const;

function formatearHoraCorta(iso: string | null): string {
  if (!iso) return '--:--';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '--:--';
  return fecha.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export const AiAssistant: React.FC<AiAssistantProps> = ({ ultimaCapturaIso }) => {
  const [inputPregunta, setInputPregunta] = useState<string>('');
  const [cargando, setCargando] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [ultimaRespuesta, setUltimaRespuesta] = useState<{
    encabezado: string;
    tiempo: string;
    texto: string;
  }>({
    encabezado: `Análisis sobre captura de las ${formatearHoraCorta(ultimaCapturaIso)} hs:`,
    tiempo: 'Listo para consultar',
    texto:
      'Seleccioná una pregunta rápida o escribí tu consulta para que Gemini Flash analice la última imagen capturada por el ESP32.',
  });

  const ejecutarConsulta = async (preguntaTexto: string) => {
    const limpia = preguntaTexto.trim();
    if (!limpia || cargando) return;

    setInputPregunta('');
    setCargando(true);
    setError(null);

    try {
      const data = await consultarAsistenteVisual(limpia);
      setUltimaRespuesta({
        encabezado: `Respuesta a: "${limpia}"`,
        tiempo: 'Ahora',
        texto: data.respuesta,
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'No se pudo conectar con el servicio de IA (/api/consultar-ia).';
      setError(msg);
    } finally {
      setCargando(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    ejecutarConsulta(inputPregunta);
  };

  return (
    <section className="rounded-2xl bg-slate-800/60 border border-indigo-500/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 text-xs">
            <i className="fa-solid fa-wand-magic-sparkles" />
          </div>
          <h3 className="text-sm font-bold text-white">Consulta Visual a la IA</h3>
        </div>
        <span className="text-[11px] text-slate-400">Bajo demanda</span>
      </div>

      {/* Respuesta de la IA */}
      <div
        id="respuesta-ia"
        className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 leading-relaxed"
      >
        {cargando ? (
          <span className="text-indigo-400 animate-pulse flex items-center gap-1.5">
            <i className="fa-solid fa-circle-notch fa-spin" />
            Consultando al modelo de visión sobre la última captura...
          </span>
        ) : error ? (
          <div className="text-rose-300 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-rose-400 font-medium">
              <span>
                <i className="fa-solid fa-circle-exclamation mr-1" /> Error al consultar IA
              </span>
              <span>Ahora</span>
            </div>
            <p className="text-slate-300">{error}</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between text-[11px] text-indigo-400 font-medium mb-1 gap-2">
              <span className="truncate">
                <i className="fa-solid fa-robot mr-1" /> {ultimaRespuesta.encabezado}
              </span>
              <span className="shrink-0">{ultimaRespuesta.tiempo}</span>
            </div>
            <p className="text-slate-200">"{ultimaRespuesta.texto}"</p>
          </>
        )}
      </div>

      {/* Preguntas frecuentes rápidas (Chips) */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {CHIPS_PREGUNTAS.map((chip) => (
          <button
            key={chip.label}
            type="button"
            disabled={cargando}
            onClick={() => ejecutarConsulta(chip.pregunta)}
            className="shrink-0 px-2.5 py-1 rounded-full bg-slate-900 hover:bg-indigo-950 border border-slate-700 hover:border-indigo-500/50 text-[11px] text-slate-300 transition cursor-pointer disabled:opacity-50"
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Input libre */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          id="input-pregunta"
          type="text"
          value={inputPregunta}
          onChange={(e) => setInputPregunta(e.target.value)}
          disabled={cargando}
          placeholder="Preguntale a la IA sobre la foto actual..."
          className="w-full bg-slate-900 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={cargando || !inputPregunta.trim()}
          className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold shrink-0 transition cursor-pointer"
        >
          <i className="fa-solid fa-paper-plane" />
        </button>
      </form>
    </section>
  );
};
