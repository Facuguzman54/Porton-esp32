import React, { useCallback, useEffect, useState } from 'react';
import {
  actualizarFuncionalidadesFamiliaresAdmin,
  actualizarUsuarioAdmin,
  cambiarMiPassword,
  crearUsuarioAdmin,
  eliminarUsuarioAdmin,
  enviarNotificacionPushAdmin,
  listarSuscripcionesPushAdmin,
  listarUsuariosAdmin,
} from '../lib/api';
import type { DispositivoPushSuscripto, UsuarioPerfil } from '../types/porton';

interface AdminUsersModalProps {
  usuarioActual: UsuarioPerfil;
  abierto: boolean;
  tabInicial?: 'usuarios' | 'push' | 'mi-password';
  onCerrar: () => void;
}

type TabAdmin = 'usuarios' | 'push' | 'mi-password';

const MENSAJES_RAPIDOS_PUSH = [
  '🚪 ¿Alguien puede cerrar el portón?',
  '🚗 Estoy llegando a casa, abran por favor',
  '📦 Llegó un pedido en la puerta',
  '👀 Revisen la cámara del frente',
];

export const AdminUsersModal: React.FC<AdminUsersModalProps> = ({
  usuarioActual,
  abierto,
  tabInicial,
  onCerrar,
}) => {
  const esAdmin = String(usuarioActual.rol || '').trim().toLowerCase() === 'admin';
  const [tab, setTab] = useState<TabAdmin>(esAdmin ? tabInicial || 'usuarios' : 'push');
  const [actualizandoPermisos, setActualizandoPermisos] = useState<boolean>(false);

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

  // Estado para enviar notificación Push personalizada a dispositivos familiares
  const [dispositivosPush, setDispositivosPush] = useState<DispositivoPushSuscripto[]>([]);
  const [cargandoPushList, setCargandoPushList] = useState<boolean>(false);
  const [pushTitulo, setPushTitulo] = useState<string>('📢 Aviso de Admin · Vigilante Frente');
  const [pushMensaje, setPushMensaje] = useState<string>('');
  const [pushRegistrarActividad, setPushRegistrarActividad] = useState<boolean>(true);
  const [enviandoPush, setEnviandoPush] = useState<boolean>(false);

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

  const cargarSuscripcionesPush = useCallback(async () => {
    setCargandoPushList(true);
    try {
      const res = await listarSuscripcionesPushAdmin();
      setDispositivosPush(res.dispositivos);
    } catch {
      // No bloquear la pestaña si aún no hay tabla o falla la consulta
    } finally {
      setCargandoPushList(false);
    }
  }, []);

  useEffect(() => {
    if (abierto) {
      if (!esAdmin) {
        setTab('push');
      } else if (tabInicial) {
        setTab(tabInicial);
      }
    }
  }, [abierto, esAdmin, tabInicial]);

  useEffect(() => {
    if (!abierto) return;
    if (tab === 'usuarios' && esAdmin) {
      cargarUsuarios();
    } else if (tab === 'push') {
      cargarSuscripcionesPush();
    }
  }, [abierto, tab, esAdmin, cargarUsuarios, cargarSuscripcionesPush]);

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

  const usuariosFamiliares = usuarios.filter(
    (u) => String(u.rol || '').trim().toLowerCase() !== 'admin'
  );
  const globalVerRoi =
    usuariosFamiliares.length > 0 && usuariosFamiliares.every((u) => Boolean(u.ver_roi));
  const globalVerEstadisticas =
    usuariosFamiliares.length > 0 &&
    usuariosFamiliares.every((u) => Boolean(u.ver_estadisticas));
  const globalEnviarPush =
    usuariosFamiliares.length > 0 && usuariosFamiliares.every((u) => Boolean(u.enviar_push));

  const handleToggleFuncionalidadGlobal = async (
    campo: 'ver_roi' | 'ver_estadisticas' | 'enviar_push',
    nuevoValor: boolean
  ) => {
    if (actualizandoPermisos) return;
    setActualizandoPermisos(true);
    setErrorGeneral(null);
    try {
      const actualizados = await actualizarFuncionalidadesFamiliaresAdmin({
        [campo]: nuevoValor,
      });
      setUsuarios(actualizados);
      const etiqueta =
        campo === 'ver_roi'
          ? 'Ver ROI de cámaras'
          : campo === 'ver_estadisticas'
          ? 'Ver Estadísticas diarias'
          : 'Enviar Notificaciones Push';
      mostrarFeedbackExito(
        `${etiqueta}: ${nuevoValor ? 'HABILITADO' : 'DESHABILITADO'} para usuarios familiares.`
      );
    } catch (err) {
      setErrorGeneral(
        err instanceof Error ? err.message : 'Error al actualizar funcionalidades.'
      );
    } finally {
      setActualizandoPermisos(false);
    }
  };

  const handleTogglePermisoIndividual = async (
    u: UsuarioPerfil,
    campo: 'ver_roi' | 'ver_estadisticas' | 'enviar_push'
  ) => {
    if (String(u.rol || '').toLowerCase() === 'admin') return;
    setErrorGeneral(null);
    try {
      const nuevoValor = !Boolean(u[campo]);
      const actualizado = await actualizarUsuarioAdmin(u.id, { [campo]: nuevoValor });
      setUsuarios((prev) => prev.map((item) => (item.id === u.id ? actualizado : item)));
      mostrarFeedbackExito(`Permiso actualizado para @${u.username}.`);
    } catch (err) {
      setErrorGeneral(
        err instanceof Error ? err.message : 'No se pudo actualizar el permiso del usuario.'
      );
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

  const handleEnviarPushPersonalizado = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviandoPush || !pushMensaje.trim()) return;

    setEnviandoPush(true);
    setErrorGeneral(null);
    try {
      const res = await enviarNotificacionPushAdmin({
        titulo: pushTitulo.trim() || `📢 Aviso de ${usuarioActual.nombre}`,
        mensaje: pushMensaje.trim(),
        registrar_en_actividad: pushRegistrarActividad,
      });
      setPushMensaje('');
      mostrarFeedbackExito(res.mensaje);
      cargarSuscripcionesPush();
    } catch (err) {
      setErrorGeneral(
        err instanceof Error ? err.message : 'Error al enviar la notificación Push.'
      );
    } finally {
      setEnviandoPush(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header del Modal */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/95">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 text-sm">
              <i className={`fa-solid ${esAdmin ? 'fa-users-gear' : 'fa-bullhorn text-cyan-400'}`} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">
                {esAdmin ? 'Panel de Administración' : 'Enviar Aviso Push Familiar'}
              </h2>
              <p className="text-[11px] text-slate-400">
                {esAdmin
                  ? 'Gestión de usuarios, funcionalidades y seguridad'
                  : 'Notificación instantánea a los demás dispositivos'}
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

        {/* Selector de Pestañas (visible para Admin) */}
        {esAdmin && (
          <div className="grid grid-cols-3 gap-1.5 p-2.5 bg-slate-950/60 border-b border-slate-800/80 text-xs">
            <button
              type="button"
              onClick={() => {
                setTab('usuarios');
                setErrorGeneral(null);
              }}
              className={`py-2 px-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
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
                setTab('push');
                setErrorGeneral(null);
              }}
              className={`py-2 px-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                tab === 'push'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <i className="fa-solid fa-bullhorn" />
              <span>Enviar Push</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('mi-password');
                setErrorGeneral(null);
              }}
              className={`py-2 px-2 rounded-xl font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                tab === 'mi-password'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <i className="fa-solid fa-key" />
              <span>Mi Clave</span>
            </button>
          </div>
        )}

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
              {/* PANEL DE FUNCIONALIDADES HABILITADAS PARA USUARIOS FAMILIARES */}
              <div className="rounded-2xl bg-slate-950/80 border border-indigo-500/30 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <i className="fa-solid fa-sliders text-indigo-400 text-xs" />
                    <span className="text-xs font-bold text-white">
                      Funcionalidades habilitadas (Usuarios)
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">Rol Familiar</span>
                </div>

                <div className="space-y-2 pt-0.5">
                  {/* Switch 1: Ver ROI */}
                  <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2">
                    <div>
                      <p className="font-semibold text-slate-200 text-xs flex items-center gap-1.5">
                        <i className="fa-solid fa-vector-square text-amber-400 text-[11px]" />
                        Ver ROI de Cámaras
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Muestra los recuadros Zona A/B, Ancla Techo y diferencial
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={actualizandoPermisos}
                      onClick={() => handleToggleFuncionalidadGlobal('ver_roi', !globalVerRoi)}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                        globalVerRoi
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      <i
                        className={`fa-solid ${
                          globalVerRoi ? 'fa-toggle-on text-emerald-400' : 'fa-toggle-off'
                        }`}
                      />
                      <span>{globalVerRoi ? 'Activo' : 'Oculto'}</span>
                    </button>
                  </div>

                  {/* Switch 2: Ver Estadísticas */}
                  <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2">
                    <div>
                      <p className="font-semibold text-slate-200 text-xs flex items-center gap-1.5">
                        <i className="fa-solid fa-chart-simple text-indigo-400 text-[11px]" />
                        Ver Estadísticas Diarias
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Muestra Aperturas hoy, Tiempo prom. y Alertas (&gt;10m)
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={actualizandoPermisos}
                      onClick={() =>
                        handleToggleFuncionalidadGlobal(
                          'ver_estadisticas',
                          !globalVerEstadisticas
                        )
                      }
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                        globalVerEstadisticas
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      <i
                        className={`fa-solid ${
                          globalVerEstadisticas
                            ? 'fa-toggle-on text-emerald-400'
                            : 'fa-toggle-off'
                        }`}
                      />
                      <span>{globalVerEstadisticas ? 'Activo' : 'Oculto'}</span>
                    </button>
                  </div>

                  {/* Switch 3: Permitir enviar notificaciones Push */}
                  <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-xl px-3 py-2">
                    <div>
                      <p className="font-semibold text-slate-200 text-xs flex items-center gap-1.5">
                        <i className="fa-solid fa-bullhorn text-cyan-400 text-[11px]" />
                        Enviar Notificaciones Push
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Permite a los usuarios enviar avisos Push personalizados
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={actualizandoPermisos}
                      onClick={() =>
                        handleToggleFuncionalidadGlobal('enviar_push', !globalEnviarPush)
                      }
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                        globalEnviarPush
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                    >
                      <i
                        className={`fa-solid ${
                          globalEnviarPush ? 'fa-toggle-on text-emerald-400' : 'fa-toggle-off'
                        }`}
                      />
                      <span>{globalEnviarPush ? 'Activo' : 'Inactivo'}</span>
                    </button>
                  </div>
                </div>
              </div>

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
                                ? 'Acceso total: ROIs, Estadísticas, IA, Push y Usuarios'
                                : 'Acceso familiar: IA + Actividad Realtime'}
                            </p>
                            {u.rol !== 'admin' && (
                              <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleTogglePermisoIndividual(u, 'ver_roi')}
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition cursor-pointer ${
                                    u.ver_roi
                                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                                      : 'bg-slate-900 border-slate-700 text-slate-500'
                                  }`}
                                >
                                  ROI: {u.ver_roi ? 'Sí' : 'No'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleTogglePermisoIndividual(u, 'ver_estadisticas')
                                  }
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition cursor-pointer ${
                                    u.ver_estadisticas
                                      ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                                      : 'bg-slate-900 border-slate-700 text-slate-500'
                                  }`}
                                >
                                  Stats: {u.ver_estadisticas ? 'Sí' : 'No'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleTogglePermisoIndividual(u, 'enviar_push')}
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition cursor-pointer ${
                                    u.enviar_push
                                      ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                                      : 'bg-slate-900 border-slate-700 text-slate-500'
                                  }`}
                                >
                                  Push: {u.enviar_push ? 'Sí' : 'No'}
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Acciones rápidas por usuario */}
                          <div className="flex items-center gap-1 shrink-0">
                            {esMiCuenta ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setTab('mi-password');
                                  setErrorGeneral(null);
                                }}
                                title="Ir a Mi Clave Admin para cambiar tu propia contraseña"
                                className="px-2.5 py-1 rounded-lg bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-500/40 text-emerald-300 text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer"
                              >
                                <i className="fa-solid fa-key" />
                                <span>Mi Clave</span>
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setUsuarioEditandoPassId(editandoPass ? null : u.id);
                                    setPasswordResetValor('');
                                  }}
                                  title="Asignar nueva contraseña a este usuario"
                                  className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] transition cursor-pointer"
                                >
                                  <i className="fa-solid fa-key" />
                                </button>
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

                        {/* Caja inline para asignar nueva contraseña a usuarios familiares */}
                        {!esMiCuenta && editandoPass && (
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
          ) : tab === 'push' ? (
            /* Pestaña 2: Enviar notificación Push personalizada a dispositivos familiares */
            <form onSubmit={handleEnviarPushPersonalizado} className="space-y-3">
              <div className="rounded-2xl bg-slate-800/60 border border-slate-800 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-mobile-screen-button text-cyan-400" />
                    Dispositivos con Push Activo
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    {cargandoPushList ? '...' : `${dispositivosPush.length} suscripto(s)`}
                  </span>
                </div>
                {dispositivosPush.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {dispositivosPush.map((d) => (
                      <span
                        key={d.id}
                        className="px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-700/80 text-[10px] text-slate-300 flex items-center gap-1"
                      >
                        <i className="fa-solid fa-bell text-emerald-400 text-[9px]" />
                        {d.etiqueta}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    Los dispositivos que toquen &ldquo;Activar Push&rdquo; recibirán la alerta en segundo plano, y los que tengan la PWA abierta la recibirán al instante en pantalla.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1.5">
                  Mensajes rápidos (tocá para completar)
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {MENSAJES_RAPIDOS_PUSH.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setPushMensaje(chip)}
                      className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-300 transition cursor-pointer"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Título de la notificación
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={pushTitulo}
                  onChange={(e) => setPushTitulo(e.target.value)}
                  placeholder="📢 Aviso de Admin · Vigilante Frente"
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Mensaje personalizado
                </label>
                <textarea
                  rows={3}
                  required
                  maxLength={350}
                  value={pushMensaje}
                  onChange={(e) => setPushMensaje(e.target.value)}
                  placeholder="Escribí el mensaje que verán los demás dispositivos familiares..."
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-2 text-white outline-none resize-none"
                />
              </div>

              <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pushRegistrarActividad}
                  onChange={(e) => setPushRegistrarActividad(e.target.checked)}
                  className="rounded accent-cyan-500"
                />
                <span>Mostrar también en vivo en &ldquo;Actividad de Hoy&rdquo; (Realtime)</span>
              </label>

              <button
                type="submit"
                disabled={enviandoPush || !pushMensaje.trim()}
                className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold transition cursor-pointer flex items-center justify-center gap-1.5"
              >
                {enviandoPush ? (
                  <>
                    <i className="fa-solid fa-circle-notch fa-spin" />
                    <span>Enviando notificación...</span>
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-paper-plane" />
                    <span>Enviar Notificación Push a Dispositivos</span>
                  </>
                )}
              </button>
            </form>
          ) : (
            /* Pestaña 3: Cambiar mi propia contraseña de usuario admin */
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
