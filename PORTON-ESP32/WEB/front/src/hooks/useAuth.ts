import { useCallback, useEffect, useState } from 'react';
import {
  clearStoredAccessToken,
  getStoredAccessToken,
  loginConBackend,
  obtenerSesionActualBackend,
  setStoredAccessToken,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import type { UsuarioPerfil } from '../types/porton';

const DOMINIO_INTERNO_AUTH = '@vigilantefrente.local';

function normalizarEmailDesdeUsuario(usernameOrEmail: string): string {
  const limpio = usernameOrEmail.trim().toLowerCase();
  if (limpio.includes('@')) return limpio;
  return `${limpio}${DOMINIO_INTERNO_AUTH}`;
}

export function useAuth() {
  const [usuario, setUsuario] = useState<UsuarioPerfil | null>(null);
  const [cargandoAuth, setCargandoAuth] = useState<boolean>(true);
  const [errorAuth, setErrorAuth] = useState<string | null>(null);

  const obtenerPerfilDesdeDb = useCallback(
    async (authUserId: string): Promise<UsuarioPerfil | null> => {
      if (!supabase) return null;

      const { data, error } = await supabase
        .from('usuarios')
        .select(
          'id, username, nombre, rol, activo, ver_roi, ver_estadisticas, enviar_push, auth_user_id, ultimo_acceso'
        )
        .eq('auth_user_id', authUserId)
        .eq('activo', true)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return data as UsuarioPerfil;
    },
    []
  );

  useEffect(() => {
    let cancelado = false;

    async function verificarSesionInicial() {
      const storedToken = getStoredAccessToken();

      // 1. Validar primero contra el backend FastAPI (GET /api/auth/me) si hay token almacenado
      if (storedToken) {
        try {
          const perfilBackend = await obtenerSesionActualBackend();
          if (!cancelado) {
            setUsuario(perfilBackend);
            setCargandoAuth(false);
          }
          return;
        } catch {
          clearStoredAccessToken();
        }
      }

      // 2. Fallback: Verificar sesión de Supabase Auth si existe
      if (!supabase) {
        if (!cancelado) {
          setUsuario(null);
          setCargandoAuth(false);
        }
        return;
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          if (!cancelado) {
            setUsuario(null);
            setCargandoAuth(false);
          }
          return;
        }

        const perfil = await obtenerPerfilDesdeDb(user.id);
        if (!perfil) {
          await supabase.auth.signOut();
          if (!cancelado) {
            setUsuario(null);
            setCargandoAuth(false);
          }
          return;
        }

        if (!cancelado) {
          setUsuario(perfil);
          setCargandoAuth(false);
        }
      } catch {
        if (!cancelado) {
          setUsuario(null);
          setCargandoAuth(false);
        }
      }
    }

    verificarSesionInicial();

    return () => {
      cancelado = true;
    };
  }, [obtenerPerfilDesdeDb]);

  const iniciarSesion = useCallback(
    async (usernameInput: string, passwordInput: string): Promise<boolean> => {
      const usernameLimpio = usernameInput.trim();
      if (!usernameLimpio || !passwordInput) {
        setErrorAuth('Completá tu usuario y contraseña.');
        return false;
      }

      setErrorAuth(null);

      // 1. Vía principal: Autenticar contra `POST /api/auth/login` del backend FastAPI
      try {
        const resp = await loginConBackend(usernameLimpio, passwordInput);
        setStoredAccessToken(resp.access_token);

        // Sincronizar sesión GoTrue en el cliente Supabase para Realtime autenticado (RLS)
        if (supabase && resp.supabase_access_token && resp.supabase_refresh_token) {
          await supabase.auth
            .setSession({
              access_token: resp.supabase_access_token,
              refresh_token: resp.supabase_refresh_token,
            })
            .catch(() => null);
        } else if (supabase) {
          // Si el backend no devolvió tokens GoTrue, iniciar sesión GoTrue directamente
          const email = normalizarEmailDesdeUsuario(usernameLimpio);
          await supabase.auth
            .signInWithPassword({ email, password: passwordInput })
            .catch(() => null);
        }

        setUsuario(resp.usuario);
        return true;
      } catch (backendErr) {
        // Si fue un 401 explícito del backend (credenciales inválidas), mostrar el mensaje directamente
        const mensajeError =
          backendErr instanceof Error ? backendErr.message : 'Error de autenticación.';
        const esErrorDeRed =
          backendErr instanceof TypeError ||
          mensajeError.toLowerCase().includes('failed to fetch') ||
          mensajeError.toLowerCase().includes('networkerror');

        if (!esErrorDeRed) {
          setErrorAuth(mensajeError);
          return false;
        }
      }

      // 2. Fallback directo contra Supabase Auth + `public.usuarios` si el backend FastAPI está apagado
      if (!supabase) {
        setErrorAuth('No se pudo conectar con el servidor de autenticación.');
        return false;
      }

      const email = normalizarEmailDesdeUsuario(usernameLimpio);
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: passwordInput,
      });

      if (error || !data.user) {
        setErrorAuth('Usuario o contraseña incorrectos.');
        return false;
      }

      const perfil = await obtenerPerfilDesdeDb(data.user.id);
      if (!perfil) {
        await supabase.auth.signOut();
        setErrorAuth('Tu cuenta está deshabilitada o no figura en la tabla de usuarios.');
        return false;
      }

      await supabase.rpc('registrar_acceso_usuario');
      setUsuario({
        ...perfil,
        ultimo_acceso: new Date().toISOString(),
      });
      return true;
    },
    [obtenerPerfilDesdeDb]
  );

  const cerrarSesion = useCallback(async () => {
    clearStoredAccessToken();
    if (supabase) {
      await supabase.auth.signOut().catch(() => null);
    }
    setUsuario(null);
  }, []);

  return {
    usuario,
    cargandoAuth,
    errorAuth,
    iniciarSesion,
    cerrarSesion,
  };
}
