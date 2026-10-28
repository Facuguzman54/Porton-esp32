import React, { useState } from 'react';

interface LoginCardProps {
  onLogin: (username: string, password: string) => Promise<boolean>;
  errorAuth: string | null;
}

export const LoginCard: React.FC<LoginCardProps> = ({ onLogin, errorAuth }) => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [mostrarPassword, setMostrarPassword] = useState<boolean>(false);
  const [enviando, setEnviando] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando || !username.trim() || !password) return;

    setEnviando(true);
    try {
      await onLogin(username, password);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="text-slate-100 flex justify-center items-center min-h-screen p-4 sm:p-6">
      <div className="w-full max-w-md bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        {/* Encabezado de marca */}
        <div className="px-6 pt-8 pb-6 text-center bg-gradient-to-b from-emerald-950/40 via-slate-900 to-slate-900 border-b border-slate-800/80">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-800 border border-emerald-500/40 shadow-lg flex items-center justify-center text-emerald-400 text-2xl mb-3">
            <i className="fa-solid fa-shield-halved" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-white">Vigilante Frente</h1>
          <p className="text-xs text-slate-400 mt-1">
            Sistema Inteligente de Monitoreo de Portón
          </p>
        </div>

        {/* Formulario de acceso validado contra public.usuarios */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label
              htmlFor="login-username"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
            >
              Usuario
            </label>
            <div className="relative flex items-center">
              <i className="fa-solid fa-user absolute left-3.5 text-slate-500 text-xs pointer-events-none" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                required
                disabled={enviando}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ej: admin"
                className="w-full bg-slate-950/90 border border-slate-700/90 focus:border-emerald-500 rounded-xl pl-9 pr-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5"
            >
              Contraseña
            </label>
            <div className="relative flex items-center">
              <i className="fa-solid fa-lock absolute left-3.5 text-slate-500 text-xs pointer-events-none" />
              <input
                id="login-password"
                type={mostrarPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                disabled={enviando}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-950/90 border border-slate-700/90 focus:border-emerald-500 rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition disabled:opacity-50"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setMostrarPassword((prev) => !prev)}
                className="absolute right-3 text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
                title={mostrarPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
              >
                <i className={`fa-solid ${mostrarPassword ? 'fa-eye-slash' : 'fa-eye'}`} />
              </button>
            </div>
          </div>

          {errorAuth && (
            <div className="rounded-xl bg-rose-950/80 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-200 flex items-center gap-2">
              <i className="fa-solid fa-circle-exclamation text-rose-400 shrink-0" />
              <span>{errorAuth}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={enviando || !username.trim() || !password}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold text-sm shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 transition cursor-pointer"
          >
            {enviando ? (
              <>
                <i className="fa-solid fa-circle-notch fa-spin" />
                <span>Validando con la base de datos...</span>
              </>
            ) : (
              <>
                <i className="fa-solid fa-right-to-bracket" />
                <span>Ingresar al Monitor</span>
              </>
            )}
          </button>

          <div className="pt-2 text-center">
            <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
              <i className="fa-solid fa-database text-slate-600" />
              Acceso protegido por Supabase Auth + RLS (`public.usuarios`)
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};
