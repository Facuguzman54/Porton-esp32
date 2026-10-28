import React, { useEffect, useState } from 'react';
import { suscribirNotificacionesPush, verificarEstadoPushInicial } from '../lib/api';
import type { UsuarioPerfil } from '../types/porton';

interface HeaderProps {
  esp32Online: boolean;
  realtimeConnected: boolean;
  usuario: UsuarioPerfil;
  esAdmin: boolean;
  onAbrirAdminPanel: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  esp32Online,
  realtimeConnected,
  usuario,
  esAdmin,
  onAbrirAdminPanel,
  onLogout,
}) => {
  const [pushActivo, setPushActivo] = useState<boolean>(false);
  const [cargandoPush, setCargandoPush] = useState<boolean>(false);
  const [mensajePush, setMensajePush] = useState<string | null>(null);

  useEffect(() => {
    verificarEstadoPushInicial().then(setPushActivo);
  }, []);

  const handleTogglePush = async () => {
    if (cargandoPush) return;
    setCargandoPush(true);
    setMensajePush(null);
    try {
      const resultado = await suscribirNotificacionesPush();
      setPushActivo(resultado.ok);
      setMensajePush(resultado.mensaje);
      window.setTimeout(() => setMensajePush(null), 4000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al suscribir notificaciones Push';
      setMensajePush(msg);
      window.setTimeout(() => setMensajePush(null), 4500);
    } finally {
      setCargandoPush(false);
    }
  };

  return (
    <header className="px-5 pt-4 pb-3 border-b border-slate-800/80 relative">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400 shrink-0">
            <i className="fa-solid fa-shield-halved text-lg" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="font-bold text-base leading-tight text-white truncate">
                Vigilante Frente
              </h1>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${
                  esAdmin
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                }`}
              >
                {esAdmin ? 'Admin' : usuario.nombre}
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-1.5 truncate mt-0.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  esp32Online
                    ? 'bg-emerald-400 animate-pulse'
                    : realtimeConnected
                    ? 'bg-amber-400'
                    : 'bg-slate-500'
                }`}
              />
              <span className="truncate">
                {esp32Online ? 'ESP32 Online · En vivo' : 'Conectado · Esperando ESP32'}
              </span>
            </p>
          </div>
        </div>

        {/* Acciones derechas: Admin Usuarios / Enviar Aviso + Push Web + Cerrar sesión */}
        <div className="flex items-center gap-1.5 shrink-0">
          {esAdmin ? (
            <button
              type="button"
              onClick={onAbrirAdminPanel}
              title="Administrar usuarios, funcionalidades, enviar Push y cambiar clave admin"
              className="px-2.5 py-1.5 rounded-full bg-indigo-950/70 hover:bg-indigo-900/80 border border-indigo-500/40 text-xs font-medium text-indigo-300 flex items-center gap-1.5 transition cursor-pointer"
            >
              <i className="fa-solid fa-users-gear text-indigo-400" />
              <span className="hidden sm:inline">Usuarios</span>
            </button>
          ) : (
            Boolean(usuario.enviar_push) && (
              <button
                type="button"
                onClick={onAbrirAdminPanel}
                title="Enviar notificación Push personalizada a los demás dispositivos"
                className="px-2.5 py-1.5 rounded-full bg-cyan-950/70 hover:bg-cyan-900/80 border border-cyan-500/40 text-xs font-medium text-cyan-300 flex items-center gap-1.5 transition cursor-pointer"
              >
                <i className="fa-solid fa-bullhorn text-cyan-400" />
                <span className="hidden sm:inline">Enviar Aviso</span>
              </button>
            )
          )}

          <button
            type="button"
            onClick={handleTogglePush}
            disabled={cargandoPush}
            title={
              pushActivo
                ? 'Notificaciones Web Push activas en este dispositivo'
                : 'Activar alertas Web Push (>10m abierto o cámara movida)'
            }
            className={`px-3 py-1.5 rounded-full border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
              pushActivo
                ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                : 'bg-slate-800/80 hover:bg-indigo-950/70 border-slate-700 hover:border-indigo-500/50 text-slate-300'
            }`}
          >
            <i
              className={`fa-solid ${
                cargandoPush
                  ? 'fa-circle-notch fa-spin text-indigo-400'
                  : pushActivo
                  ? 'fa-bell text-emerald-400'
                  : 'fa-bell-slash text-slate-400'
              }`}
            />
            <span>{pushActivo ? 'Push Activo' : 'Activar Push'}</span>
          </button>

          <button
            type="button"
            onClick={onLogout}
            title={`Conectado como ${usuario.nombre} (@${usuario.username}) · Click para cerrar sesión`}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-rose-950/80 border border-slate-700 hover:border-rose-500/50 text-slate-400 hover:text-rose-300 flex items-center justify-center text-xs transition cursor-pointer"
          >
            <i className="fa-solid fa-right-from-bracket" />
          </button>
        </div>
      </div>

      {mensajePush && (
        <div className="mt-2 px-3 py-1.5 rounded-lg bg-slate-800/90 border border-slate-700 text-[11px] text-slate-300 flex items-center justify-between">
          <span>{mensajePush}</span>
          <button
            type="button"
            onClick={() => setMensajePush(null)}
            className="text-slate-400 hover:text-white ml-2"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      )}
    </header>
  );
};
