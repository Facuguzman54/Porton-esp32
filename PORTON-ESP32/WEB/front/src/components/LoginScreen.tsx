import React, { useState } from 'react';
import { iniciarSesion } from '../lib/api';
import type { UsuarioAutenticado } from '../types/porton';

interface LoginScreenProps {
  onLoginSuccess: (usuario: UsuarioAutenticado) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [mostrarPassword, setMostrarPassword] = useState<boolean>(false);
  const [cargando, setCargando] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password || cargando) return;

    setCargando(true);
    setError(null);

    try {
      const res = await iniciarSesion(username, password);
      onLoginSuccess(res.usuario);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo conectar con el servidor de autenticación.'
      );
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="text-slate-100 flex justify-center items-center min-h-screen p-4 sm:p-6">
      <div className="w-full max-w-sm bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl p-6 space-y-6">
        {/* Encabezado de marca */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-2xl shadow-lg">
            <i className="fa-solid fa-shield-halved" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-white">
            Vigilante Frente
          </h1>
          <p className="text-xs text-slate-400">
            Acceso familiar restringido · Monitoreo de Portón ESP32
          </p>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-xl bg-rose-950/80 border border-rose-500/50 px-3.5 py-2.5 text-xs text-rose-200 flex items-start gap-2">
              <i className="fa-solid fa-circle-exclamation text-rose-400 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="login-username"
              className="block text-xs font-semibold text-slate-300"
            >
              Usuario
            </label>
            <div className="relative">
              <i className="fa-solid fa-user absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ej: admin o tu usuario familiar"
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none transition"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="login-password"
              className="block text-xs font-semibold text-slate-300"
            >
              Contraseña
            </label>
            <div className="relative">
              <i className="fa-solid fa-key absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs" />
              <input
                id="login-password"
                type={mostrarPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl pl-9 pr-10 py-2.5 text-xs text-white placeholder-slate-500 outline-none transition"
              />
              <button
                type="button"
                onClick={() => setMostrarPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs cursor-pointer"
                tabIndex={-1}
              >
                <i className={`fa-solid ${mostrarPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={cargando || !username.trim() || !password}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold tracking-wide transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-950/50"
          >
            {cargando ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin" />
                <span>Verificando acceso...</span>
              </>
            ) : (
              <>
                <i className="fa-solid fa-right-to-bracket" />
                <span>Ingresar al Panel</span>
              </>
            )}
          </button>
        </form>

        <div className="pt-3 border-t border-slate-800/80 text-center">
          <p className="text-[11px] text-slate-500">
            <i className="fa-solid fa-database mr-1 text-slate-400" />
            Usuarios administrados desde <code className="text-slate-400">public.usuarios</code> en Supabase
          </p>
        </div>
      </div>
    </div>
  );
};
