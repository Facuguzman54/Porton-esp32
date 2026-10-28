import base64
import json
import logging
from typing import Any
import httpx

from .config import Settings
from .schemas import JuezIaVeredicto, TelemetriaPayload

logger = logging.getLogger("vigilante.gemini")


class GeminiService:
    """
    Puente hacia Google Gemini 2.5 Flash cumpliendo el Uso Racional de Cuota Gratuita (AGENTS.md):
    1. Juez de Última Instancia: solo en zona gris (-30.0 a -20.0) o antes de alertas críticas (>10 min / CAMARA_MOVIDA).
    2. Asistente Visual Interactivo: bajo demanda manual desde la PWA (`POST /api/consultar-ia`).
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.api_key = settings.gemini_api_key.strip()
        self.model = settings.gemini_model.strip() or "gemini-2.5-flash"
        self.ultimo_error: str | None = None

    async def _invocar_gemini(
        self,
        prompt: str,
        jpeg_bytes: bytes | None,
        json_mode: bool = False,
    ) -> str | None:
        self.ultimo_error = None
        if not self.api_key:
            self.ultimo_error = "GEMINI_API_KEY no configurada en el backend."
            logger.warning(self.ultimo_error)
            return None

        parts: list[dict[str, Any]] = [{"text": prompt}]
        if jpeg_bytes:
            parts.append(
                {
                    "inlineData": {
                        "mimeType": "image/jpeg",
                        "data": base64.b64encode(jpeg_bytes).decode("ascii"),
                    }
                }
            )
            logger.info(
                "Adjuntando captura JPEG a Gemini (%d bytes / %.1f KB)",
                len(jpeg_bytes),
                len(jpeg_bytes) / 1024.0,
            )
        else:
            logger.warning("Invocando a Gemini sin bytes JPEG adjuntos.")

        generation_config: dict[str, Any] = {
            "temperature": 0.2,
            "maxOutputTokens": 1024,
        }
        if json_mode:
            generation_config["responseMimeType"] = "application/json"

        payload = {
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": generation_config,
        }

        modelos_a_probar = [self.model]
        if "gemini-2.0-flash" not in modelos_a_probar:
            modelos_a_probar.append("gemini-2.0-flash")

        # Las claves que comienzan con "AQ." pertenecen a Vertex AI Express Mode (aiplatform.googleapis.com),
        # mientras que las que comienzan con "AIza" pertenecen a Google AI Studio (generativelanguage.googleapis.com).
        es_vertex_key = self.api_key.startswith("AQ.")
        base_url = (
            "https://aiplatform.googleapis.com/v1/publishers/google/models"
            if es_vertex_key
            else "https://generativelanguage.googleapis.com/v1beta/models"
        )

        async with httpx.AsyncClient(timeout=12.0) as client:
            for modelo in modelos_a_probar:
                url = f"{base_url}/{modelo}:generateContent"
                try:
                    resp = await client.post(
                        url,
                        params={"key": self.api_key},
                        json=payload,
                    )
                    if resp.status_code >= 400:
                        body_preview = resp.text[:400]
                        logger.warning(
                            "Gemini (%s en %s) devolvió HTTP %d: %s",
                            modelo,
                            base_url.split("/")[2],
                            resp.status_code,
                            body_preview,
                        )
                        if "SERVICE_DISABLED" in body_preview or "aiplatform.googleapis.com" in body_preview and resp.status_code == 403:
                            self.ultimo_error = (
                                "La API de Vertex AI (aiplatform.googleapis.com) está deshabilitada en el proyecto "
                                "de Google Cloud asociado a tu GEMINI_API_KEY (AQ...), o podés usar una clave 'AIza...' de Google AI Studio."
                            )
                            break
                        if "API_KEY_INVALID" in body_preview or resp.status_code in (401, 403):
                            self.ultimo_error = f"Google rechazó la GEMINI_API_KEY (HTTP {resp.status_code})."
                            break
                        if resp.status_code == 429:
                            self.ultimo_error = "Cuota gratuita de Gemini temporalmente agotada (HTTP 429)."
                        continue

                    data = resp.json()
                    candidates = data.get("candidates") or []
                    if not candidates:
                        continue
                    content_parts = candidates[0].get("content", {}).get("parts") or []
                    texto = "".join(
                        p.get("text", "") for p in content_parts if not p.get("thought")
                    ).strip()
                    if texto:
                        return texto
                except Exception as exc:
                    self.ultimo_error = f"Timeout de red hacia Gemini ({modelo})."
                    logger.warning(
                        "Timeout o error de red consultando Gemini (%s): %s", modelo, exc
                    )
                    break

        return None

    async def evaluar_como_juez(
        self,
        telemetria: TelemetriaPayload,
        motivo: str,
        jpeg_bytes: bytes | None,
    ) -> JuezIaVeredicto | None:
        """
        Actúa como Juez de Última Instancia cuando hay incertidumbre en ROIs o antes de una alerta crítica.
        """
        prompt = (
            "Sos el Juez de Visión Artificial del sistema 'Vigilante Frente' que monitorea un portón corredizo doméstico "
            "con una cámara IP XM530 (640x360 px).\n"
            f"Motivo de invocación: {motivo}.\n"
            f"Lectura del nodo Edge ESP32: estado={telemetria.estado}, "
            f"Zona A (Pared X:335-382, Y:95-175)={telemetria.brillo_a:.1f}, "
            f"Zona B (Portón X:475-575, Y:100-175)={telemetria.brillo_b:.1f}, "
            f"Diff={telemetria.diff_porton:+.1f} (Umbral=-25.0), "
            f"Ancla Techo={telemetria.brillo_techo:.1f} ({'Día' if telemetria.es_de_dia else 'Noche'}).\n\n"
            "Analizá visualmente la captura (si está adjunta) y las métricas, y respondé ESTRICTAMENTE en JSON con este esquema:\n"
            '{"estado_visual": "CERRADO" | "ABIERTO" | "CAMARA_MOVIDA", "confianza": 0.0 a 1.0, "justificacion": "breve explicación en español (máx 140 caracteres)"}'
        )

        respuesta_raw = await self._invocar_gemini(prompt, jpeg_bytes, json_mode=True)
        if not respuesta_raw:
            return None

        try:
            limpio = respuesta_raw.strip()
            if limpio.startswith("```"):
                limpio = limpio.strip("`").removeprefix("json").strip()
            parsed = json.loads(limpio)
            return JuezIaVeredicto.model_validate(parsed)
        except Exception as exc:
            logger.warning("No se pudo parsear JSON del Juez IA (%s): %s", exc, respuesta_raw)
            return None

    async def responder_consulta_visual(
        self,
        pregunta: str,
        jpeg_bytes: bytes | None,
        estado_contexto: dict[str, Any] | None,
    ) -> str:
        """
        Responde en español claro y conciso una consulta del usuario desde el Chat Visual de la PWA.
        """
        ctx_str = ""
        if estado_contexto:
            ctx_str = (
                f"Contexto actual del sensor ESP32: Estado={estado_contexto.get('estado', 'CERRADO')}, "
                f"Zona A (Pared)={estado_contexto.get('brillo_a', 0):.1f}, "
                f"Zona B (Portón)={estado_contexto.get('brillo_b', 0):.1f}, "
                f"Diff={estado_contexto.get('diff_porton', 0):+.1f}, "
                f"Ancla Techo={estado_contexto.get('brillo_techo', 0):.0f} "
                f"({'Día' if estado_contexto.get('es_de_dia') else 'Noche'}).\n"
            )

        prompt = (
            "Sos el Asistente Visual de 'Vigilante Frente', el sistema familiar de monitoreo de portón corredizo.\n"
            f"{ctx_str}"
            f"Pregunta del usuario: \"{pregunta}\"\n\n"
            "Instrucciones:\n"
            "- Respondé en español rioplatense claro, directo y amable (máximo 2 o 3 oraciones).\n"
            "- Describí lo que se observa en la imagen del frente/garaje respecto al portón, vehículos, mascotas u objetos en el riel.\n"
            "- Si no se adjuntó una imagen física aún en el bucket, indicá el estado reportado por los sensores del ESP32 con precisión."
        )

        texto = await self._invocar_gemini(prompt, jpeg_bytes, json_mode=False)
        if texto:
            return texto.strip().strip('"')

        # Fallback informativo si la API de Gemini da error de cuota, permisos o red
        img_info = (
            f"La captura de la cámara sí fue recibida ({len(jpeg_bytes) / 1024.0:.1f} KB)"
            if jpeg_bytes
            else "No se encontró captura en caché/bucket"
        )
        motivo_api = f" Detalle API: {self.ultimo_error}" if self.ultimo_error else ""
        if estado_contexto:
            est = estado_contexto.get("estado", "CERRADO")
            diff = estado_contexto.get("diff_porton", 0.0)
            techo = estado_contexto.get("brillo_techo", 0.0)
            return (
                f"{img_info}. Según el nodo ESP32 el portón está {est} "
                f"(Diferencial A-B: {diff:+.1f}, Ancla Techo: {techo:.0f}).{motivo_api}"
            )
        return f"{img_info}, pero el servicio de visión en la nube no pudo procesarla.{motivo_api}"
