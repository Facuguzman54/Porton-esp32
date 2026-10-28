import React, { useCallback, useEffect, useState } from 'react';
import {
  actualizarUsuarioAdmin,
  cambiarMiPassword,
  crearUsuarioAdmin,
  eliminarUsuarioAdmin,
  listarUsuariosAdmin,
} from '../lib/api';
import type { UsuarioPerfil } from '../types/porton';

interface AdminUsersModalProps {
  usuarioActual: UsuarioPerfil;
  abierto: boolean;
  onCerrar: () => void;
}

type TabAdmin = 'usuarios' | 'mi-password';

export const AdminUsersModal: React.FC<AdminUsersModalProps> = ({
  usuarioActual,
  abierto,
  onCerrar,
}) => {
  const [tab, setTab] = useState<TabAdmin>('usuarios');

  // Estado de lista de usuarios
  const [usuarios, setUsuarios] = useState<UsuarioPerfil[]>([]);
  const [cargandoLista, setCargandoLista] = useState<boolean>(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // Estado para crear nuevo usuario
  const [mostrarFormCrear, setMostrarFormCrear] = useState<boolean>(false);
  const [nuevoUsername, setNuevoUsername] = useState<string>('');
  const [nuevoNombre, setNuevoNombre] = useState<string>('');
  const [nuevoRol, setNuevoRol] = useState<'familiar' | 'admin'>('familiar');
  const [nuevoPassword, setNuevoPassword] = useState<string>('');
  const [guardandoUsuario, setGuardandoUsuario] = useState<boolean>(false);

  // Estado para cambiar contraseña de un usuario específico de la lista
  const [usuarioEditandoPassId, setUsuarioEditandoPassId] = useState<string | null>(null);
  const [passwordResetValor, setPasswordResetValor] = useState<string>('');

  // Estado para cambiar la propia contraseña del admin
  const [passActual, setPassActual] = useState<string>('');
  const [passNueva, setPassNueva] = useState<string>('');
  const [passConfirmar, setPassConfirmar] = useState<string>('');
  const [cambiandoMiPass, setCambiandoMiPass] = useState<boolean>(false);

  const cargarUsuarios = useCallback(async () => {
    setCargandoLista(true);
    setErrorGeneral(null);
    try {
      const data = await listarUsuariosAdmin();
      setUsuarios(data);
    } catch (err) {
      setErrorGeneral(
        err instanceof Error ? err.message : 'No se pudo cargar la lista de usuarios.'
      );
    } finally {
      setCargandoLista(false);
    }
  }, []);

  useEffect(() => {
    if (abierto && tab === 'usuarios') {
      cargarUsuarios();
    }
  }, [abierto, tab, cargarUsuarios]);

  if (!abierto) return null;

  const mostrarFeedbackExito = (msg: string) => {
    setMensajeExito(msg);
    setErrorGeneral(null);
    window.setTimeout(() => setMensajeExito(null), 4000);
  };

  const handleCrearUsuario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoUsername.trim() || !nuevoNombre.trim() || !nuevoPassword || guardandoUsuario) return;

    setGuardandoUsuario(true);
    setErrorGeneral(null);
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
      setNuevoRol('familiar');
      setNuevoPassword('');
      setMostrarFormCrear(false);
      mostrarFeedbackExito(`Usuario "${creado.username}" creado correctamente.`);
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'Error al crear el usuario.');
    } finally {
      setGuardandoUsuario(false);
    }
  };

  const handleToggleActivo = async (u: UsuarioPerfil) => {
    if (u.id === usuarioActual.id) return;
    setErrorGeneral(null);
    try {
      const actualizado = await actualizarUsuarioAdmin(u.id, {
        activo: !(u.activo ?? true),
      });
      setUsuarios((prev) => prev.map((item) => (item.id === u.id ? actualizado : item)));
      mostrarFeedbackExito(
        `Usuario "${u.username}" ${actualizado.activo ? 'activado' : 'desactivado'}.`
      );
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'Error al cambiar estado del usuario.');
    }
  };

  const handleToggleRol = async (u: UsuarioPerfil) => {
    if (u.id === usuarioActual.id) return;
    const siguienteRol: 'admin' | 'familiar' = u.rol === 'admin' ? 'familiar' : 'admin';
    setErrorGeneral(null);
    try {
      const actualizado = await actualizarUsuarioAdmin(u.id, { rol: siguienteRol });
      setUsuarios((prev) => prev.map((item) => (item.id === u.id ? actualizado : item)));
      mostrarFeedbackExito(`Rol de "${u.username}" cambiado a ${siguienteRol.toUpperCase()}.`);
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'Error al actualizar el rol.');
    }
  };

  const handleGuardarResetPasswordUsuario = async (u: UsuarioPerfil) => {
    if (!passwordResetValor.trim() || passwordResetValor.trim().length < 4) {
      setErrorGeneral('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }
    setErrorGeneral(null);
    try {
      await actualizarUsuarioAdmin(u.id, { password: passwordResetValor });
      setUsuarioEditandoPassId(null);
      setPasswordResetValor('');
      mostrarFeedbackExito(`Contraseña de "${u.username}" actualizada.`);
    } catch (err) {
      setErrorGeneral(
        err instanceof Error ? err.message : 'No se pudo actualizar la contraseña del usuario.'
      );
    }
  };

  const handleEliminarUsuario = async (u: UsuarioPerfil) => {
    if (u.id === usuarioActual.id) return;
    if (!window.confirm(`¿Seguro que querés eliminar al usuario "${u.username}"?`)) return;

    setErrorGeneral(null);
    try {
      await eliminarUsuarioAdmin(u.id);
      setUsuarios((prev) => prev.filter((item) => item.id !== u.id));
      mostrarFeedbackExito(`Usuario "${u.username}" eliminado.`);
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : 'Error al eliminar el usuario.');
    }
  };

  const handleCambiarMiPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cambiandoMiPass) return;

    if (passNueva.length < 4) {
      setErrorGeneral('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }
    if (passNueva !== passConfirmar) {
      setErrorGeneral('La nueva contraseña y su confirmación no coinciden.');
      return;
    }

    setCambiandoMiPass(true);
    setErrorGeneral(null);
    try {
      const res = await cambiarMiPassword(passActual, passNueva);
      setPassActual('');
      setPassNueva('');
      setPassConfirmar('');
      mostrarFeedbackExito(res.mensaje || 'Tu contraseña de administrador fue actualizada.');
    } catch (err) {
      setErrorGeneral(
        err instanceof Error ? err.message : 'No se pudo actualizar tu contraseña.'
      );
    } finally {
      setCambiandoMiPass(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header del Modal */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/95">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 text-sm">
              <i className="fa-solid fa-users-gear" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Panel de Administración</h2>
              <p className="text-[11px] text-slate-400">
                Gestión de usuarios y seguridad (`public.usuarios`)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center text-xs transition cursor-pointer"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Selector de Pestañas */}
        <div className="grid grid-cols-2 gap-1.5 p-2.5 bg-slate-950/60 border-b border-slate-800/80 text-xs">
          <button
            type="button"
            onClick={() => {
              setTab('usuarios');
              setErrorGeneral(null);
            }}
            className={`py-2 px-3 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              tab === 'usuarios'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <i className="fa-solid fa-users" />
            <span>Usuarios ({usuarios.length || 2})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('mi-password');
              setErrorGeneral(null);
            }}
            className={`py-2 px-3 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              tab === 'mi-password'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <i className="fa-solid fa-key" />
            <span>Mi Clave Admin</span>
          </button>
        </div>

        {/* Cuerpo Scrollable */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1 text-xs">
          {errorGeneral && (
            <div className="rounded-xl bg-rose-950/80 border border-rose-500/40 px-3 py-2 text-rose-200 flex items-center justify-between gap-2">
              <span>
                <i className="fa-solid fa-circle-exclamation text-rose-400 mr-1.5" />
                {errorGeneral}
              </span>
              <button
                type="button"
                onClick={() => setErrorGeneral(null)}
                className="text-rose-300 hover:text-white"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          )}

          {mensajeExito && (
            <div className="rounded-xl bg-emerald-950/80 border border-emerald-500/40 px-3 py-2 text-emerald-200 flex items-center justify-between gap-2">
              <span>
                <i className="fa-solid fa-circle-check text-emerald-400 mr-1.5" />
                {mensajeExito}
              </span>
            </div>
          )}

          {tab === 'usuarios' ? (
            <div className="space-y-3">
              {/* Barra superior: botón Nuevo Usuario */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Cuentas registradas
                </span>
                <button
                  type="button"
                  onClick={() => setMostrarFormCrear((prev) => !prev)}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-300 font-semibold text-[11px] flex items-center gap-1 transition cursor-pointer"
                >
                  <i className={`fa-solid ${mostrarFormCrear ? 'fa-minus' : 'fa-user-plus'}`} />
                  <span>{mostrarFormCrear ? 'Cancelar' : 'Nuevo Usuario'}</span>
                </button>
              </div>

              {/* Formulario de creación de usuario */}
              {mostrarFormCrear && (
                <form
                  onSubmit={handleCrearUsuario}
                  className="rounded-2xl bg-slate-950/90 border border-indigo-500/40 p-3.5 space-y-2.5"
                >
                  <p className="font-bold text-indigo-300 text-xs">Crear nueva cuenta</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">
                        Usuario (login)
                      </label>
                      <input
                        type="text"
                        required
                        value={nuevoUsername}
                        onChange={(e) => setNuevoUsername(e.target.value)}
                        placeholder="ej: familiar2"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Rol</label>
                      <select
                        value={nuevoRol}
                        onChange={(e) => setNuevoRol(e.target.value as 'familiar' | 'admin')}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-indigo-500"
                      >
                        <option value="familiar">Familiar (Sin ROI/Stats)</option>
                        <option value="admin">Admin (Acceso Total)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">
                        Nombre visible
                      </label>
                      <input
                        type="text"
                        required
                        value={nuevoNombre}
                        onChange={(e) => setNuevoNombre(e.target.value)}
                        placeholder="Ej: Familiar"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-400 mb-1">Contraseña</label>
                      <input
                        type="text"
                        required
                        minLength={4}
                        value={nuevoPassword}
                        onChange={(e) => setNuevoPassword(e.target.value)}
                        placeholder="Mín. 4 caracteres"
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={guardandoUsuario}
                    className="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition cursor-pointer"
                  >
                    {guardandoUsuario ? 'Guardando...' : 'Guardar Usuario'}
                  </button>
                </form>
              )}

              {/* Lista de usuarios */}
              {cargandoLista ? (
                <div className="py-8 text-center text-slate-400">
                  <i className="fa-solid fa-circle-notch fa-spin mr-1.5 text-indigo-400" />
                  Cargando usuarios...
                </div>
              ) : (
                <div className="space-y-2.5">
                  {usuarios.map((u) => {
                    const esMiCuenta = u.id === usuarioActual.id;
                    const activo = u.activo ?? true;
                    const editandoPass = usuarioEditandoPassId === u.id;

                    return (
                      <div
                        key={u.id}
                        className={`rounded-2xl p-3 border transition ${
                          activo
                            ? 'bg-slate-800/60 border-slate-800'
                            : 'bg-slate-900/40 border-slate-800/50 opacity-60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-white text-xs">{u.nombre}</span>
                              <span className="font-mono text-[11px] text-slate-400">
                                @{u.username}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                  u.rol === 'admin'
                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                    : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                                }`}
                              >
                                {u.rol === 'admin' ? 'Admin' : 'Familiar'}
                              </span>
                              {!activo && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                  Inactivo
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">
                              {u.rol === 'admin'
                                ? 'Acceso total: ROIs, Estadísticas, IA y Usuarios'
                                : 'Acceso familiar: IA + Actividad Realtime (sin ROI ni estadísticas)'}
                            </p>
                          </div>

                          {/* Acciones rápidas por usuario */}
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setUsuarioEditandoPassId(editandoPass ? null : u.id);
                                setPasswordResetValor('');
                              }}
                              title="Cambiar contraseña de este usuario"
                              className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] transition cursor-pointer"
                            >
                              <i className="fa-solid fa-key" />
                            </button>

                            {!esMiCuenta && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleToggleRol(u)}
                                  title="Alternar rol Familiar / Admin"
                                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] transition cursor-pointer"
                                >
                                  <i className="fa-solid fa-user-shield" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleActivo(u)}
                                  title={activo ? 'Desactivar cuenta' : 'Activar cuenta'}
                                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] transition cursor-pointer"
                                >
                                  <i
                                    className={`fa-solid ${
                                      activo
                                        ? 'fa-toggle-on text-emerald-400'
                                        : 'fa-toggle-off text-slate-500'
                                    }`}
                                  />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleEliminarUsuario(u)}
                                  title="Eliminar usuario"
                                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-rose-950 border border-slate-700 hover:border-rose-500/40 text-rose-400 text-[11px] transition cursor-pointer"
                                >
                                  <i className="fa-solid fa-trash" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Caja inline para asignar nueva contraseña a este usuario */}
                        {editandoPass && (
                          <div className="mt-2.5 pt-2.5 border-t border-slate-700/80 flex items-center gap-2">
                            <input
                              type="text"
                              value={passwordResetValor}
                              onChange={(e) => setPasswordResetValor(e.target.value)}
                              placeholder={`Nueva clave para @${u.username}...`}
                              className="w-full bg-slate-900 border border-slate-700 focus:border-emerald-500 rounded-lg px-2.5 py-1.5 text-white outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleGuardarResetPasswordUsuario(u)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shrink-0 cursor-pointer"
                            >
                              Guardar
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Pestaña 2: Cambiar mi propia contraseña de usuario admin */
            <form onSubmit={handleCambiarMiPassword} className="space-y-3">
              <div className="rounded-2xl bg-slate-800/50 border border-slate-800 p-3">
                <p className="font-semibold text-slate-200">
                  Cambiar contraseña de <span className="text-emerald-400">@{usuarioActual.username}</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Se validará tu contraseña actual en la base de datos y se actualizará con hash bcrypt.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Contraseña actual
                </label>
                <input
                  type="password"
                  required
                  value={passActual}
                  onChange={(e) => setPassActual(e.target.value)}
                  placeholder="Ingresá tu contraseña actual"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Nueva contraseña
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={passNueva}
                  onChange={(e) => setPassNueva(e.target.value)}
                  placeholder="Mínimo 4 caracteres"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Confirmar nueva contraseña
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={passConfirmar}
                  onChange={(e) => setPassConfirmar(e.target.value)}
                  placeholder="Repetí la nueva contraseña"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={cambiandoMiPass || !passActual || !passNueva || !passConfirmar}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold transition cursor-pointer"
              >
                {cambiandoMiPass ? (
                  <>
                    <i className="fa-solid fa-circle-notch fa-spin mr-1.5" />
                    Actualizando contraseña...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-check mr-1.5" />
                    Actualizar Contraseña Admin
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
