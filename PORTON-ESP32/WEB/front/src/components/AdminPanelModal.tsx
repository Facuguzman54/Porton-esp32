import React, { useEffect, useState } from 'react';
import {
  actualizarUsuarioAdmin,
  cambiarMiPassword,
  crearUsuarioAdmin,
  eliminarUsuarioAdmin,
  listarUsuariosAdmin,
} from '../lib/api';
import type { UsuarioPerfil } from '../types/porton';

interface AdminPanelModalProps {
  usuarioActual: UsuarioPerfil;
  onClose: () => void;
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  usuarioActual,
  onClose,
}) => {
  const [tab, setTab] = useState<'usuarios' | 'password'>('usuarios');
  const [usuarios, setUsuarios] = useState<UsuarioPerfil[]>([]);
  const [cargandoLista, setCargandoLista] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Formulario de nuevo usuario
  const [nuevoUsername, setNuevoUsername] = useState<string>('');
  const [nuevoNombre, setNuevoNombre] = useState<string>('');
  const [nuevoRol, setNuevoRol] = useState<'familiar' | 'admin'>('familiar');
  const [nuevoPassword, setNuevoPassword] = useState<string>('');
  const [guardandoNuevo, setGuardandoNuevo] = useState<boolean>(false);

  // Edición de contraseña de otro usuario
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPasswordValor, setResetPasswordValor] = useState<string>('');

  // Cambio de contraseña propia del Admin
  const [passActual, setPassActual] = useState<string>('');
  const [passNueva, setPassNueva] = useState<string>('');
  const [passConfirmar, setPassConfirmar] = useState<string>('');
  const [guardandoPass, setGuardandoPass] = useState<boolean>(false);

  const cargarUsuarios = async () => {
    setCargandoLista(true);
    setErrorMsg(null);
    try {
      const lista = await listarUsuariosAdmin();
      setUsuarios(lista);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo cargar la lista de usuarios.'
      );
    } finally {
      setCargandoLista(false);
    }
  };

  useEffect(() => {
    cargarUsuarios();
  }, []);

  const limpiarMensajes = () => {
    setErrorMsg(null);
    setOkMsg(null);
  };

  const handleCrearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    limpiarMensajes();
    if (!nuevoUsername.trim() || !nuevoNombre.trim() || nuevoPassword.length < 4) {
      setErrorMsg('Completá usuario, nombre y una contraseña de al menos 4 caracteres.');
      return;
    }

    setGuardandoNuevo(true);
    try {
      const creado = await crearUsuarioAdmin({
        username: nuevoUsername.trim().toLowerCase(),
        nombre: nuevoNombre.trim(),
        rol: nuevoRol,
        password: nuevoPassword,
        activo: true,
      });
      setUsuarios((prev) => [...prev, creado]);
      setNuevoUsername('');
      setNuevoNombre('');
      setNuevoPassword('');
      setNuevoRol('familiar');
      setOkMsg(`Usuario @${creado.username} creado correctamente.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al crear el usuario.');
    } finally {
      setGuardandoNuevo(false);
    }
  };

  const handleToggleActivo = async (u: UsuarioPerfil) => {
    limpiarMensajes();
    const nuevoEstado = !(u.activo ?? true);
    try {
      const actualizado = await actualizarUsuarioAdmin(u.id, { activo: nuevoEstado });
      setUsuarios((prev) => prev.map((item) => (item.id === u.id ? actualizado : item)));
      setOkMsg(
        `Usuario @${u.username} ${nuevoEstado ? 'activado' : 'desactivado'}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo cambiar el estado.');
    }
  };

  const handleCambiarRol = async (u: UsuarioPerfil) => {
    limpiarMensajes();
    const siguienteRol = u.rol === 'admin' ? 'familiar' : 'admin';
    try {
      const actualizado = await actualizarUsuarioAdmin(u.id, { rol: siguienteRol });
      setUsuarios((prev) => prev.map((item) => (item.id === u.id ? actualizado : item)));
      setOkMsg(`Rol de @${u.username} cambiado a ${siguienteRol.toUpperCase()}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo actualizar el rol.');
    }
  };

  const handleGuardarResetPassword = async (u: UsuarioPerfil) => {
    limpiarMensajes();
    if (resetPasswordValor.trim().length < 4) {
      setErrorMsg('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }
    try {
      await actualizarUsuarioAdmin(u.id, { password: resetPasswordValor.trim() });
      setResetUserId(null);
      setResetPasswordValor('');
      setOkMsg(`Contraseña de @${u.username} actualizada.`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudo blanquear la contraseña.'
      );
    }
  };

  const handleEliminarUsuario = async (u: UsuarioPerfil) => {
    limpiarMensajes();
    if (!window.confirm(`¿Eliminar definitivamente al usuario @${u.username}?`)) return;
    try {
      await eliminarUsuarioAdmin(u.id);
      setUsuarios((prev) => prev.filter((item) => item.id !== u.id));
      setOkMsg(`Usuario @${u.username} eliminado.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo eliminar el usuario.');
    }
  };

  const handleCambiarMiPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    limpiarMensajes();
    if (passNueva.length < 4) {
      setErrorMsg('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }
    if (passNueva !== passConfirmar) {
      setErrorMsg('La confirmación de la nueva contraseña no coincide.');
      return;
    }

    setGuardandoPass(true);
    try {
      const res = await cambiarMiPassword({
        password_actual: passActual,
        password_nueva: passNueva,
      });
      setPassActual('');
      setPassNueva('');
      setPassConfirmar('');
      setOkMsg(res.mensaje || 'Tu contraseña de administrador fue actualizada.');
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Error al cambiar la contraseña.'
      );
    } finally {
      setGuardandoPass(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-md max-h-[90vh] bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Encabezado */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 text-sm">
              <i className="fa-solid fa-users-gear" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Panel de Administración</h2>
              <p className="text-[11px] text-slate-400">
                Sesión: {usuarioActual.nombre} (@{usuarioActual.username})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs cursor-pointer"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Pestañas */}
        <div className="px-4 pt-3 flex gap-2 border-b border-slate-800/80 pb-2.5">
          <button
            type="button"
            onClick={() => {
              limpiarMensajes();
              setTab('usuarios');
            }}
            className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              tab === 'usuarios'
                ? 'bg-indigo-600/25 text-indigo-300 border-indigo-500/50'
                : 'bg-slate-800/60 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <i className="fa-solid fa-users mr-1.5" />
            Usuarios ({usuarios.length})
          </button>
          <button
            type="button"
            onClick={() => {
              limpiarMensajes();
              setTab('password');
            }}
            className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
              tab === 'password'
                ? 'bg-indigo-600/25 text-indigo-300 border-indigo-500/50'
                : 'bg-slate-800/60 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <i className="fa-solid fa-key mr-1.5" />
            Mi Contraseña
          </button>
        </div>

        {/* Contenido scrollable */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {errorMsg && (
            <div className="rounded-xl bg-rose-950/80 border border-rose-500/50 px-3 py-2 text-rose-200 flex items-center justify-between">
              <span>
                <i className="fa-solid fa-circle-exclamation text-rose-400 mr-1.5" />
                {errorMsg}
              </span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-rose-300 hover:text-white ml-2"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          )}

          {okMsg && (
            <div className="rounded-xl bg-emerald-950/80 border border-emerald-500/50 px-3 py-2 text-emerald-200 flex items-center justify-between">
              <span>
                <i className="fa-solid fa-circle-check text-emerald-400 mr-1.5" />
                {okMsg}
              </span>
              <button
                type="button"
                onClick={() => setOkMsg(null)}
                className="text-emerald-300 hover:text-white ml-2"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          )}

          {tab === 'usuarios' ? (
            <>
              {/* Formulario para agregar nuevo usuario */}
              <form
                onSubmit={handleCrearUsuario}
                className="rounded-2xl bg-slate-800/50 border border-slate-800 p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">
                    <i className="fa-solid fa-user-plus text-indigo-400 mr-1.5" />
                    Añadir Usuario
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Familiar: sin ROIs ni estadísticas
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={nuevoUsername}
                    onChange={(e) => setNuevoUsername(e.target.value)}
                    placeholder="Usuario (ej: familiar)"
                    className="bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-2.5 py-1.5 text-white placeholder-slate-500 outline-none"
                  />
                  <input
                    type="text"
                    value={nuevoNombre}
                    onChange={(e) => setNuevoNombre(e.target.value)}
                    placeholder="Nombre visible"
                    className="bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-2.5 py-1.5 text-white placeholder-slate-500 outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="password"
                    value={nuevoPassword}
                    onChange={(e) => setNuevoPassword(e.target.value)}
                    placeholder="Contraseña inicial"
                    className="bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-2.5 py-1.5 text-white placeholder-slate-500 outline-none"
                  />
                  <select
                    value={nuevoRol}
                    onChange={(e) => setNuevoRol(e.target.value as 'familiar' | 'admin')}
                    className="bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-2.5 py-1.5 text-white outline-none"
                  >
                    <option value="familiar">Rol: Familiar</option>
                    <option value="admin">Rol: Admin</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={guardandoNuevo}
                  className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-semibold transition cursor-pointer"
                >
                  {guardandoNuevo ? 'Creando usuario...' : 'Crear Usuario'}
                </button>
              </form>

              {/* Lista de usuarios registrados */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Usuarios en Supabase
                  </span>
                  <button
                    type="button"
                    onClick={cargarUsuarios}
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                  >
                    <i className="fa-solid fa-rotate mr-1" /> Actualizar
                  </button>
                </div>

                {cargandoLista ? (
                  <div className="py-6 text-center text-slate-400">
                    <i className="fa-solid fa-circle-notch fa-spin mr-1.5" />
                    Cargando usuarios...
                  </div>
                ) : (
                  usuarios.map((u) => {
                    const esYo = u.id === usuarioActual.id;
                    const activo = u.activo ?? true;
                    return (
                      <div
                        key={u.id}
                        className="rounded-xl bg-slate-800/60 border border-slate-800 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-white">{u.nombre}</span>
                              <span className="font-mono text-[11px] text-slate-400">
                                @{u.username}
                              </span>
                              {esYo && (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">
                                  Vos
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                  u.rol === 'admin'
                                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                                    : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                }`}
                              >
                                {u.rol === 'admin' ? 'Admin (Total)' : 'Familiar (Sin ROIs/Stats)'}
                              </span>
                              <span
                                className={`text-[10px] ${
                                  activo ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                ● {activo ? 'Activo' : 'Bloqueado'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setResetUserId(resetUserId === u.id ? null : u.id);
                                setResetPasswordValor('');
                              }}
                              title="Cambiar contraseña de este usuario"
                              className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 cursor-pointer"
                            >
                              <i className="fa-solid fa-key" />
                            </button>
                            {!esYo && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleCambiarRol(u)}
                                  title="Alternar rol Admin / Familiar"
                                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 cursor-pointer"
                                >
                                  <i className="fa-solid fa-user-shield" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleActivo(u)}
                                  title={activo ? 'Bloquear acceso' : 'Habilitar acceso'}
                                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 cursor-pointer"
                                >
                                  <i
                                    className={`fa-solid ${
                                      activo ? 'fa-ban text-amber-400' : 'fa-check text-emerald-400'
                                    }`}
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleEliminarUsuario(u)}
                                  title="Eliminar usuario"
                                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-rose-950 border border-slate-700 hover:border-rose-500/40 text-rose-400 cursor-pointer"
                                >
                                  <i className="fa-solid fa-trash" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {resetUserId === u.id && (
                          <div className="pt-2 border-t border-slate-800 flex gap-1.5">
                            <input
                              type="password"
                              value={resetPasswordValor}
                              onChange={(e) => setResetPasswordValor(e.target.value)}
                              placeholder={`Nueva clave para @${u.username}`}
                              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-white outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleGuardarResetPassword(u)}
                              className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                            >
                              Guardar
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            /* Pestaña: Cambiar mi propia contraseña de Admin */
            <form
              onSubmit={handleCambiarMiPassword}
              className="rounded-2xl bg-slate-800/50 border border-slate-800 p-4 space-y-3"
            >
              <h3 className="font-bold text-white text-sm">
                Cambiar Contraseña de @{usuarioActual.username}
              </h3>
              <p className="text-[11px] text-slate-400">
                La nueva contraseña se encripta automáticamente con bcrypt en Supabase.
              </p>

              <div className="space-y-1">
                <label className="block text-[11px] text-slate-300">Contraseña actual</label>
                <input
                  type="password"
                  required
                  value={passActual}
                  onChange={(e) => setPassActual(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] text-slate-300">Nueva contraseña</label>
                <input
                  type="password"
                  required
                  value={passNueva}
                  onChange={(e) => setPassNueva(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-[11px] text-slate-300">
                  Confirmar nueva contraseña
                </label>
                <input
                  type="password"
                  required
                  value={passConfirmar}
                  onChange={(e) => setPassConfirmar(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={guardandoPass}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white font-bold transition cursor-pointer"
              >
                {guardandoPass ? 'Actualizando...' : 'Actualizar Mi Contraseña'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
