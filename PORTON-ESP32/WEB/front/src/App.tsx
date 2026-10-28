import React from 'react';
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
  const { estadoActual, eventosHoy, estadisticas, realtimeConnected, esp32Online } =
    usePortonRealtime(Boolean(usuario));

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

  return (
    <div className="text-slate-100 flex justify-center min-h-screen p-0 sm:p-6">
      {/* Contenedor formato Smartphone */}
      <div className="w-full max-w-md bg-slate-900 sm:rounded-3xl sm:border sm:border-slate-800 shadow-2xl overflow-hidden flex flex-col">
        {/* HEADER PWA */}
        <Header
          esp32Online={esp32Online}
          realtimeConnected={realtimeConnected}
          usuario={usuario}
          onLogout={cerrarSesion}
        />

        {/* CONTENIDO PRINCIPAL SCROLLABLE */}
        <main className="p-4 space-y-4 flex-1 overflow-y-auto">
          {/* 1. TARJETA DE ESTADO ACTUAL */}
          <StatusCard estadoActual={estadoActual} />

          {/* 2. VISOR DE ÚLTIMA CAPTURA CON ROIs 640x360 */}
          <CameraViewer estadoActual={estadoActual} />

          {/* 3. ASISTENTE VISUAL IA INTERACTIVO */}
          <AiAssistant ultimaCapturaIso={estadoActual.updated_at} />

          {/* 4. RESUMEN DIARIO Y ESTADÍSTICAS */}
          <DailyStats estadisticas={estadisticas} />

          {/* 5. HISTORIAL DE EVENTOS EN TIEMPO REAL */}
          <EventHistory eventos={eventosHoy} realtimeConnected={realtimeConnected} />
        </main>
      </div>
    </div>
  );
};

export default App;
