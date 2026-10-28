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

    async def _invocar_gemini(
        self,
        prompt: str,
        jpeg_bytes: bytes | None,
        json_mode: bool = False,
    ) -> str | None:
        if not self.api_key:
            logger.warning("GEMINI_API_KEY no configurada.")
            return None

        parts: list[dict[str, Any]] = [{"text": prompt}]
        if jpeg_bytes:
            parts.append(
                {
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": base64.b64encode(jpeg_bytes).decode("ascii"),
                    }
                }
            )

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
        base_urls = (
            [
                "https://aiplatform.googleapis.com/v1/publishers/google/models",
                "https://generativelanguage.googleapis.com/v1beta/models",
            ]
            if es_vertex_key
            else [
                "https://generativelanguage.googleapis.com/v1beta/models",
                "https://aiplatform.googleapis.com/v1/publishers/google/models",
            ]
        )

        for modelo in modelos_a_probar:
            for base_url in base_urls:
                url = f"{base_url}/{modelo}:generateContent"
                try:
                    async with httpx.AsyncClient(timeout=15.0) as client:
                        resp = await client.post(
                            url,
                            params={"key": self.api_key},
                            json=payload,
                        )
                        if resp.status_code in (401, 403):
                            resp = await client.post(
                                url,
                                headers={"x-goog-api-key": self.api_key},
                                json=payload,
                            )
                        if resp.status_code >= 400:
                            logger.warning(
                                "Gemini (%s en %s) devolvió HTTP %d: %s",
                                modelo,
                                base_url.split("/")[2],
                                resp.status_code,
                                resp.text[:250],
                            )
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
                    logger.warning(
                        "Timeout o error de red consultando Gemini (%s): %s", modelo, exc
                    )

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

        # Fallback informativo si la API de Gemini da error de cuota o red
        if estado_contexto:
            est = estado_contexto.get("estado", "CERRADO")
            diff = estado_contexto.get("diff_porton", 0.0)
            techo = estado_contexto.get("brillo_techo", 0.0)
            return (
                f"Según las lecturas en vivo del nodo ESP32, el portón se encuentra {est} "
                f"(Diferencial A-B: {diff:+.1f}, Ancla Techo: {techo:.0f}). "
                "En este momento no se pudo contactar la API de visión en la nube para detallar otros objetos extra."
            )
        return "El sistema registra el portón monitoreado por el ESP32, pero el servicio de visión en la nube no respondió a tiempo."
