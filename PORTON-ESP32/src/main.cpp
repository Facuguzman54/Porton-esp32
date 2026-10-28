#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <TJpg_Decoder.h>
#include <time.h>
#include <string.h>
#include "secrets.h"

const char* WIFI_SSID = SECRET_WIFI_SSID;
const char* WIFI_PASS = SECRET_WIFI_PASS;
const char* CAM_URL   = SECRET_CAM_URL;

const char* BACKEND_TELEMETRIA_URL = SECRET_BACKEND_TELEMETRIA_URL;
const char* BACKEND_CAPTURA_URL    = SECRET_BACKEND_CAPTURA_URL;
const char* ESP32_API_KEY          = SECRET_ESP32_API_KEY;

// Configuración NTP para Argentina (UTC-3, sin horario de verano actual)
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = -3 * 3600; 
const int   daylightOffset_sec = 0;

// --- 1. ZONAS DEL PORTÓN ELEVADAS (Y: 95 a 175) ---
const uint16_t ZONA_A_X1 = 335, ZONA_A_Y1 = 95,  ZONA_A_X2 = 382, ZONA_A_Y2 = 175;
const uint16_t ZONA_B_X1 = 475, ZONA_B_Y1 = 100, ZONA_B_X2 = 575, ZONA_B_Y2 = 175;

// --- 2. ANCLAS PARA DETECTAR MOVIMIENTO ---
const uint16_t ANCLA_TECHO_X1  = 15,  ANCLA_TECHO_Y1  = 5,  ANCLA_TECHO_X2  = 130, ANCLA_TECHO_Y2  = 45;
const uint16_t ANCLA_RINCON_X1 = 160, ANCLA_RINCON_Y1 = 55, ANCLA_RINCON_X2 = 230, ANCLA_RINCON_Y2 = 150;

uint32_t sumaBrilloA = 0, pixelesA = 0;
uint32_t sumaBrilloB = 0, pixelesB = 0;
uint32_t sumaAnclaTecho = 0, pixelesTecho = 0;
uint32_t sumaAnclaRincon = 0, pixelesRincon = 0;

// --- 3. MÁQUINA DE ESTADOS Y TIMERS ---
enum EstadoPorton { CERRADO, ABIERTO, CAMARA_MOVIDA };
EstadoPorton estadoConfirmado = CERRADO;
EstadoPorton estadoCandidato = CERRADO;
int lecturasConsecutivas = 0;

unsigned long instanteAperturaMs = 0;
bool alertaTiempoEnviada = false;
int fallosConexionConsecutivos = 0;
bool alertaDesconexionEnviada = false;
int aperturasHoy = 0;
uint32_t contadorPulsos = 0;

const float UMBRAL_DIFF_PORTON = -25.0;           
const unsigned long TIEMPO_ALERTA_MS = 20000; // 20 seg prueba local (el backend gestiona los 10 min stateless)

bool analizarBloqueJpg(int16_t x, int16_t y, uint16_t w, uint16_t h, uint16_t *bitmap) {
    bool tocaA      = !(x + w < ZONA_A_X1       || x > ZONA_A_X2       || y + h < ZONA_A_Y1       || y > ZONA_A_Y2);
    bool tocaB      = !(x + w < ZONA_B_X1       || x > ZONA_B_X2       || y + h < ZONA_B_Y1       || y > ZONA_B_Y2);
    bool tocaTecho  = !(x + w < ANCLA_TECHO_X1  || x > ANCLA_TECHO_X2  || y + h < ANCLA_TECHO_Y1  || y > ANCLA_TECHO_Y2);
    bool tocaRincon = !(x + w < ANCLA_RINCON_X1 || x > ANCLA_RINCON_X2 || y + h < ANCLA_RINCON_Y1 || y > ANCLA_RINCON_Y2);

    if (!tocaA && !tocaB && !tocaTecho && !tocaRincon) return true;

    for (uint16_t j = 0; j < h; j++) {
        for (uint16_t i = 0; i < w; i++) {
            uint16_t px = x + i;
            uint16_t py = y + j;

            uint16_t color = bitmap[j * w + i];
            uint8_t r = ((color >> 11) & 0x1F) << 3;
            uint8_t g = ((color >> 5) & 0x3F) << 2;
            uint8_t b = (color & 0x1F) << 3;
            uint8_t gris = (r + g + b) / 3;

            if (px >= ZONA_A_X1 && px <= ZONA_A_X2 && py >= ZONA_A_Y1 && py <= ZONA_A_Y2) {
                sumaBrilloA += gris; pixelesA++;
            }
            if (px >= ZONA_B_X1 && px <= ZONA_B_X2 && py >= ZONA_B_Y1 && py <= ZONA_B_Y2) {
                sumaBrilloB += gris; pixelesB++;
            }
            if (px >= ANCLA_TECHO_X1 && px <= ANCLA_TECHO_X2 && py >= ANCLA_TECHO_Y1 && py <= ANCLA_TECHO_Y2) {
                sumaAnclaTecho += gris; pixelesTecho++;
            }
            if (px >= ANCLA_RINCON_X1 && px <= ANCLA_RINCON_X2 && py >= ANCLA_RINCON_Y1 && py <= ANCLA_RINCON_Y2) {
                sumaAnclaRincon += gris; pixelesRincon++;
            }
        }
    }
    return true;
}

const char* nombreEstado(EstadoPorton e) {
    if (e == CERRADO) return "CERRADO";
    if (e == ABIERTO) return "ABIERTO";
    return "CAMARA_MOVIDA";
}

/**
 * Envía el buffer JPEG en crudo (`image/jpeg`) a `POST /api/captura` para actualizar
 * la caché en RAM del backend (y respaldo en Supabase Storage) sin usar Base64 ni fragmentar el Heap.
 * Soporta automáticamente tanto HTTPS (Cloud Render/Koyeb) como HTTP (LAN).
 */
void enviarCapturaBackend(uint8_t *jpgBuffer, int len) {
    if (!jpgBuffer || len <= 0 || WiFi.status() != WL_CONNECTED) return;

    HTTPClient httpBack;
    httpBack.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    bool esHttps = (strncmp(BACKEND_CAPTURA_URL, "https://", 8) == 0);

    if (esHttps) {
        WiFiClientSecure secureClient;
        secureClient.setInsecure();
        httpBack.setConnectTimeout(6000);
        httpBack.setTimeout(7000);
        if (httpBack.begin(secureClient, BACKEND_CAPTURA_URL)) {
            httpBack.addHeader("Content-Type", "image/jpeg");
            httpBack.addHeader("x-api-key", ESP32_API_KEY);
            int code = httpBack.POST(jpgBuffer, len);
            if (code != HTTP_CODE_OK) {
                Serial.printf("[Backend HTTPS] Aviso POST /api/captura HTTP %d\n", code);
            }
            httpBack.end();
        }
    } else {
        WiFiClient plainClient;
        httpBack.setConnectTimeout(3500);
        httpBack.setTimeout(4000);
        if (httpBack.begin(plainClient, BACKEND_CAPTURA_URL)) {
            httpBack.addHeader("Content-Type", "image/jpeg");
            httpBack.addHeader("x-api-key", ESP32_API_KEY);
            int code = httpBack.POST(jpgBuffer, len);
            if (code != HTTP_CODE_OK) {
                Serial.printf("[Backend HTTP] Aviso POST /api/captura HTTP %d\n", code);
            }
            httpBack.end();
        }
    }
}

/**
 * Envía el pulso de telemetría a `POST /api/telemetria` usando un buffer estático en pila
 * (sin `String` dinámico) incluyendo el header `x-api-key`.
 * Soporta automáticamente tanto HTTPS (Cloud Render/Koyeb) como HTTP (LAN).
 */
void enviarTelemetriaBackend(
    EstadoPorton estado,
    int lecturas,
    float brilloA,
    float brilloB,
    float diffPorton,
    float brilloTecho,
    float brilloRincon,
    bool esDeDia,
    bool camaraOnline
) {
    if (WiFi.status() != WL_CONNECTED) return;

    char jsonPayload[280];
    int n = snprintf(
        jsonPayload,
        sizeof(jsonPayload),
        "{\"estado\":\"%s\",\"lecturas_consecutivas\":%d,\"brillo_a\":%.1f,\"brillo_b\":%.1f,"
        "\"diff_porton\":%.1f,\"brillo_techo\":%.1f,\"brillo_rincon\":%.1f,"
        "\"es_de_dia\":%s,\"camara_online\":%s}",
        nombreEstado(estado),
        lecturas,
        brilloA,
        brilloB,
        diffPorton,
        brilloTecho,
        brilloRincon,
        esDeDia ? "true" : "false",
        camaraOnline ? "true" : "false"
    );

    if (n <= 0 || n >= (int)sizeof(jsonPayload)) return;

    HTTPClient httpBack;
    httpBack.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    bool esHttps = (strncmp(BACKEND_TELEMETRIA_URL, "https://", 8) == 0);

    if (esHttps) {
        WiFiClientSecure secureClient;
        secureClient.setInsecure();
        httpBack.setConnectTimeout(6000);
        httpBack.setTimeout(7000);
        if (httpBack.begin(secureClient, BACKEND_TELEMETRIA_URL)) {
            httpBack.addHeader("Content-Type", "application/json");
            httpBack.addHeader("x-api-key", ESP32_API_KEY);
            int code = httpBack.POST((uint8_t*)jsonPayload, (size_t)n);
            if (code != HTTP_CODE_OK) {
                Serial.printf("[Backend HTTPS] Aviso POST /api/telemetria HTTP %d\n", code);
            }
            httpBack.end();
        }
    } else {
        WiFiClient plainClient;
        httpBack.setConnectTimeout(3500);
        httpBack.setTimeout(4000);
        if (httpBack.begin(plainClient, BACKEND_TELEMETRIA_URL)) {
            httpBack.addHeader("Content-Type", "application/json");
            httpBack.addHeader("x-api-key", ESP32_API_KEY);
            int code = httpBack.POST((uint8_t*)jsonPayload, (size_t)n);
            if (code != HTTP_CODE_OK) {
                Serial.printf("[Backend HTTP] Aviso POST /api/telemetria HTTP %d\n", code);
            }
            httpBack.end();
        }
    }
}

void setup() {
    Serial.begin(115200);
    WiFi.mode(WIFI_STA);
    WiFi.persistent(false);
    WiFi.setAutoReconnect(true);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.print("Conectando al WiFi");
    int intentosWifi = 0;
    while (WiFi.status() != WL_CONNECTED && intentosWifi < 40) {
        delay(500);
        Serial.print(".");
        intentosWifi++;
    }
    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\nWiFi conectado! IP local: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\n[Aviso] WiFi aun no conectado tras 20s; reintentara en el loop.");
    }

    // Sincronizar la hora actual por NTP
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    Serial.println("Sincronizando hora con servidor NTP...");
    delay(2000);

    TJpgDec.setJpgScale(1);
    TJpgDec.setCallback(analizarBloqueJpg);
}

void loop() {
    if (WiFi.status() != WL_CONNECTED) {
        WiFi.reconnect();
        delay(5000);
        return;
    }

    // Obtener la hora actual del sistema
    struct tm timeinfo;
    bool horaValida = getLocalTime(&timeinfo);
    int horaActual = horaValida ? timeinfo.tm_hour : 12; // Por defecto mediodía si falla

    // Definir si es de día por horario real (Ej: de 07:00 a 20:00 es de día)
    bool esDeDiaReal = (horaActual >= 7 && horaActual < 20);

    HTTPClient http;
    http.setTimeout(4000);
    http.begin(CAM_URL);
    int httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) {
        if (alertaDesconexionEnviada) {
            Serial.println("\n>>> [INFO] LA CAMARA VOLVIO A CONECTARSE. <<<\n");
            alertaDesconexionEnviada = false;
        }
        fallosConexionConsecutivos = 0;

        int len = http.getSize();
        uint8_t *jpgBuffer = (uint8_t*)malloc(len);

        if (jpgBuffer) {
            WiFiClient *stream = http.getStreamPtr();
            int leidos = stream->readBytes(jpgBuffer, len);
            http.end();

            sumaBrilloA = 0; pixelesA = 0;
            sumaBrilloB = 0; pixelesB = 0;
            sumaAnclaTecho = 0; pixelesTecho = 0;
            sumaAnclaRincon = 0; pixelesRincon = 0;

            TJpgDec.drawJpg(0, 0, jpgBuffer, leidos);

            if (pixelesA > 0 && pixelesB > 0 && pixelesTecho > 0 && pixelesRincon > 0) {
                float brilloA = (float)sumaBrilloA / pixelesA;
                float brilloB = (float)sumaBrilloB / pixelesB;
                float diffPorton = brilloA - brilloB;

                float brilloTecho = (float)sumaAnclaTecho / pixelesTecho;
                float brilloRincon = (float)sumaAnclaRincon / pixelesRincon;

                // --- DETECTOR DE CÁMARA FUERA DE POSICIÓN USANDO HORA REAL ---
                bool camaraDesviada = false;

                if (esDeDiaReal) {
                    // De día: El techo de madera da bajo (< 55). Si supera 55, se movió.
                    if (brilloTecho > 55.0) {
                        camaraDesviada = true;
                    }
                } else {
                    // De noche: El techo con infrarrojo da alto (> 130). Si baja de 130, se movió.
                    if (brilloTecho < 130.0) {
                        camaraDesviada = true;
                    }
                }

                EstadoPorton lecturaInstantanea;
                if (camaraDesviada) {
                    lecturaInstantanea = CAMARA_MOVIDA;
                } else {
                    lecturaInstantanea = (diffPorton > UMBRAL_DIFF_PORTON) ? CERRADO : ABIERTO;
                }

                // Filtro anti-rebote (3 lecturas seguidas iguales para confirmar)
                if (lecturaInstantanea == estadoCandidato) {
                    lecturasConsecutivas++;
                } else {
                    estadoCandidato = lecturaInstantanea;
                    lecturasConsecutivas = 1;
                }

                Serial.printf("[%02d:%02d] Porton[A:%.1f B:%.1f Diff:%+.1f] | Techo:%.0f (%s) -> %s (%d/3)\n",
                              timeinfo.tm_hour, timeinfo.tm_min,
                              brilloA, brilloB, diffPorton,
                              brilloTecho, esDeDiaReal ? "Día" : "Noche",
                              nombreEstado(lecturaInstantanea), min(lecturasConsecutivas, 3));

                bool transicionConfirmada = (lecturasConsecutivas >= 3 && estadoCandidato != estadoConfirmado);
                bool enZonaGris = (diffPorton >= -30.0f && diffPorton <= -20.0f);
                contadorPulsos++;

                // Subir ultima_captura.jpg antes de liberar jpgBuffer:
                // - En el primer pulso, transición confirmada o zona gris
                // - Cada 15s (3 pulsos) si el portón está ABIERTO o hay anomalía
                // - Cada 60s (12 pulsos) cuando está CERRADO y estable (ahorra tráfico TLS)
                bool estadoActivo = (estadoConfirmado != CERRADO || lecturaInstantanea != CERRADO);
                bool subirImagen = (
                    contadorPulsos == 1 ||
                    transicionConfirmada ||
                    enZonaGris ||
                    (estadoActivo && (contadorPulsos % 3 == 0)) ||
                    (!estadoActivo && (contadorPulsos % 12 == 0))
                );
                if (subirImagen) {
                    enviarCapturaBackend(jpgBuffer, leidos);
                }

                // Liberar SIEMPRE el buffer JPEG inmediatamente después de usarlo
                free(jpgBuffer);
                jpgBuffer = nullptr;

                if (transicionConfirmada) {
                    EstadoPorton estadoAnterior = estadoConfirmado;
                    estadoConfirmado = estadoCandidato;

                    if (estadoConfirmado == CAMARA_MOVIDA) {
                        Serial.println("\n******************************************************************");
                        Serial.println("🚨 [ALERTA CRITICA] LA CAMARA SE DESVIO DE SU POSICION!");
                        Serial.println("******************************************************************\n");
                    } 
                    else if (estadoConfirmado == ABIERTO) {
                        instanteAperturaMs = millis();
                        alertaTiempoEnviada = false;
                        aperturasHoy++;
                        Serial.printf("\n>>> [EVENTO] PORTON ABIERTO (Apertura #%d del dia) <<<\n\n", aperturasHoy);
                    } 
                    else if (estadoConfirmado == CERRADO) {
                        if (estadoAnterior == CAMARA_MOVIDA) {
                            Serial.println("\n>>> [OK] LA CAMARA VOLVIO A SU POSICION NORMAL (Porton Cerrado) <<<\n");
                        } else {
                            unsigned long segAbierto = (millis() - instanteAperturaMs) / 1000;
                            Serial.printf("\n>>> [EVENTO] PORTON CERRADO (Estuvo abierto %lu segundos) <<<\n\n", segAbierto);
                        }
                    }
                }

                if (estadoConfirmado == ABIERTO && !alertaTiempoEnviada) {
                    if (millis() - instanteAperturaMs >= TIEMPO_ALERTA_MS) {
                        alertaTiempoEnviada = true;
                        Serial.println("\n************************************************************");
                        Serial.println("⚠️ [ALERTA] EL PORTON LLEVA MAS DEL TIEMPO LIMITE ABIERTO!");
                        Serial.println("************************************************************\n");
                    }
                }

                // Reportar telemetría al Backend FastAPI (POST /api/telemetria con x-api-key)
                EstadoPorton estadoAReportar = (lecturasConsecutivas >= 3) ? estadoCandidato : estadoConfirmado;
                enviarTelemetriaBackend(
                    estadoAReportar,
                    min(lecturasConsecutivas, 3),
                    brilloA,
                    brilloB,
                    diffPorton,
                    brilloTecho,
                    brilloRincon,
                    esDeDiaReal,
                    true
                );
            } else {
                free(jpgBuffer);
                jpgBuffer = nullptr;
            }
        } else {
            http.end();
        }
    } else {
        http.end();
        fallosConexionConsecutivos++;
        Serial.printf("Error HTTP camara (%d) - Fallo #%d\n", httpCode, fallosConexionConsecutivos);

        if (fallosConexionConsecutivos >= 6 && !alertaDesconexionEnviada) {
            alertaDesconexionEnviada = true;
            Serial.println("\n************************************************************");
            Serial.println("🔌 [ALERTA] CAMARA DESCONECTADA O SIN ENERGIA!");
            Serial.println("************************************************************\n");

            enviarTelemetriaBackend(
                estadoConfirmado,
                3,
                0.0f,
                0.0f,
                0.0f,
                0.0f,
                0.0f,
                esDeDiaReal,
                false
            );
        }
    }

    delay(5000);
}
