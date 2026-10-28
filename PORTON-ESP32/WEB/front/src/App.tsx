import React, { useState } from 'react';
import { AdminUsersModal } from './components/AdminUsersModal';
import { AiAssistant } from './components/AiAssistant';
import { CameraViewer } from './components/CameraViewer';
import { DailyStats } from './components/DailyStats';
import { EventHistory } from './components/EventHistory';
import { Header } from './components/Header';
import { LoginCard } from './components/LoginCard';
import { StatusCard } from './components/StatusCard';
import { useAuth } from './hooks/useAuth';
import { usePortonRealtime } from './hooks/usePortonRealtime';

export const App: React.FC = () => {
  const { usuario, cargandoAuth, errorAuth, iniciarSesion, cerrarSesion } = useAuth();
  const {
    estadoActual,
    eventosHoy,
    estadisticas,
    realtimeConnected,
    esp32Online,
    avisoReciente,
    cerrarAvisoReciente,
    eliminarEventoLocal,
    actualizarTiempoAlertaLocal,
  } = usePortonRealtime(Boolean(usuario));

  const [modalAdminAbierto, setModalAdminAbierto] = useState<boolean>(false);

  if (cargandoAuth) {
    return (
      <div className="text-slate-100 flex justify-center items-center min-h-screen p-4">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-emerald-400 text-xl">
            <i className="fa-solid fa-circle-notch fa-spin" />
          </div>
          <p className="text-xs font-medium">Verificando sesión familiar...</p>
        </div>
      </div>
    );
  }

  if (!usuario) {
    return <LoginCard onLogin={iniciarSesion} errorAuth={errorAuth} />;
  }

  const esAdmin = String(usuario.rol || '').trim().toLowerCase() === 'admin';
  const puedeVerRoi = esAdmin || Boolean(usuario.ver_roi);
  const puedeVerEstadisticas = esAdmin || Boolean(usuario.ver_estadisticas);
  const puedeEnviarPush = esAdmin || Boolean(usuario.enviar_push);

  return (
    <div className="text-slate-100 flex justify-center min-h-screen p-0 sm:p-6">
      {/* Contenedor formato Smartphone */}
      <div className="w-full max-w-md bg-slate-900 sm:rounded-3xl sm:border sm:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        {/* HEADER PWA */}
        <Header
          esp32Online={esp32Online}
          realtimeConnected={realtimeConnected}
          usuario={usuario}
          esAdmin={esAdmin}
          onAbrirAdminPanel={() => setModalAdminAbierto(true)}
          onLogout={cerrarSesion}
        />

        {/* CONTENIDO PRINCIPAL SCROLLABLE */}
        <main className="p-4 space-y-4 flex-1 overflow-y-auto">
          {avisoReciente && (
            <div className="rounded-2xl bg-cyan-950/85 border border-cyan-500/50 p-3.5 shadow-lg flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shrink-0 mt-0.5">
                  <i className="fa-solid fa-bullhorn text-sm" />
                </div>
                <div>
                  <p className="text-xs font-bold text-cyan-200">{avisoReciente.titulo}</p>
                  <p className="text-xs text-slate-200 mt-0.5">{avisoReciente.detalle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={cerrarAvisoReciente}
                className="text-cyan-300 hover:text-white text-xs px-1.5 py-0.5 cursor-pointer"
                title="Cerrar aviso"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
          )}

          {/* 1. TARJETA DE ESTADO ACTUAL */}
          <StatusCard estadoActual={estadoActual} />

          {/* 2. VISOR DE ÚLTIMA CAPTURA (ROIs visibles para admin o usuarios con ver_roi habilitado) */}
          <CameraViewer estadoActual={estadoActual} permitirRoi={puedeVerRoi} />

          {/* 3. ASISTENTE VISUAL IA INTERACTIVO (Permitido para Familiar y Admin) */}
          <AiAssistant ultimaCapturaIso={estadoActual.updated_at} />

          {/* 4. RESUMEN DIARIO Y ESTADÍSTICAS (Visible para admin o usuarios con ver_estadisticas habilitado) */}
          {puedeVerEstadisticas && (
            <DailyStats
              estadisticas={estadisticas}
              tiempoAlertaSegundos={estadoActual.tiempo_alerta_segundos || 600}
            />
          )}

          {/* 5. HISTORIAL DE EVENTOS EN TIEMPO REAL (Últimos 7 días + borrado de falsas alarmas para admin) */}
          <EventHistory
            eventos={eventosHoy}
            realtimeConnected={realtimeConnected}
            esAdmin={esAdmin}
            onEliminarEvento={eliminarEventoLocal}
          />
        </main>
      </div>

      {/* MODAL DE ADMINISTRACIÓN / ENVÍO DE PUSH PERSONALIZADO */}
      {puedeEnviarPush && (
        <AdminUsersModal
          usuarioActual={usuario}
          abierto={modalAdminAbierto}
          tiempoAlertaSegundosActual={estadoActual.tiempo_alerta_segundos || 600}
          onTiempoAlertaActualizado={actualizarTiempoAlertaLocal}
          onCerrar={() => setModalAdminAbierto(false)}
        />
      )}
    </div>
  );
};

export default App;
