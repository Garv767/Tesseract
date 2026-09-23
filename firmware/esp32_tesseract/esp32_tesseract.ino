#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <DHT.h>

// =====================================================================
// SENSOR CONFIGURATION
// =====================================================================

// ---------------- DHT11 ----------------
#define DHT_PIN 4
#define DHT_TYPE DHT11
DHT dht(DHT_PIN, DHT_TYPE);

// ---------------- MEDICINE IR SENSOR ----------------
// GPIO 18
//
// Sensor polarity configuration:
// If placing an object/medicine in front of your IR sensor makes the pin read HIGH:
// set IR_ACTIVE_STATE to HIGH.
// If your IR sensor outputs LOW on detection: set to LOW.
#define ENABLE_MEDICINE_IR 1
#define MEDICINE_IR_PIN 18
#define IR_ACTIVE_STATE HIGH

// ---------------- OPTIONAL HX711 ----------------
#define ENABLE_WEIGHT_SENSOR 0
#if ENABLE_WEIGHT_SENSOR
  #include "HX711.h"
  #define HX711_DT 32
  #define HX711_SCK 33
  HX711 scale;
  const float medicineThreshold = 10.0;
#endif

// =====================================================================
// CLOUD API
// =====================================================================
const char* API_URL = "https://tesseract-med-tracker.vercel.app/api/action";

// =====================================================================
// ACCESS POINT CONFIGURATION
// =====================================================================
const char* AP_SSID = "Tesseract-Medicine";
const char* AP_PASS = "12345678";

IPAddress ap_IP(192, 168, 4, 1);
IPAddress ap_Gateway(192, 168, 4, 1);
IPAddress ap_Subnet(255, 255, 255, 0);

// =====================================================================
// NETWORK OBJECTS
// =====================================================================
const byte DNS_PORT = 53;
DNSServer dnsServer;
WebServer server(80);
Preferences preferences;

// =====================================================================
// WIFI STATE
// =====================================================================
bool isAPMode = false;
String savedSSID = "";
String savedPassword = "";

// =====================================================================
// WIFI RECONNECTION CONFIGURATION
// =====================================================================
bool wifiReconnecting = false;
unsigned long wifiDisconnectStart = 0;
unsigned long lastReconnectAttempt = 0;
const unsigned long WIFI_RECONNECT_TIMEOUT_MS = 10000;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 2000;

// =====================================================================
// SENSOR VARIABLES
// =====================================================================
float temperature = 0.0;
float humidity = 0.0;
float currentWeight = 50.0;
bool medicinePresent = false;
bool lastMedicinePresent = false;

// =====================================================================
// SENSOR & CLOUD TIMERS (PING INTERVAL = 3 SECONDS)
// =====================================================================
unsigned long lastSensorRead = 0;
const unsigned long SENSOR_READ_INTERVAL_MS = 2000; // Read DHT11 every 2s

unsigned long lastCloudSync = 0;
const unsigned long CLOUD_SYNC_INTERVAL_MS = 3000;  // Telemetry cloud ping every 3s

// =====================================================================
// CLOUD API DISPATCHER
// =====================================================================
void sendApiAction(String action, String payload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Cloud Error] Wi-Fi disconnected. Cannot send data.");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Skip TLS certificate validation for speed & serverless compatibility

  HTTPClient http;
  http.setTimeout(5000);

  if (http.begin(client, API_URL)) {
    http.addHeader("Content-Type", "application/json");

    String requestBody = "{\"action\":\"" + action + "\",\"payload\":" + payload + "}";
    Serial.print("[Cloud API] POST " + action + "... ");

    int httpResponseCode = http.POST(requestBody);

    if (httpResponseCode > 0) {
      Serial.print("Code: ");
      Serial.println(httpResponseCode);
      if (httpResponseCode == 200) {
        Serial.println("  Cloud response: " + http.getString());
      } else {
        Serial.println("  Cloud warning: " + http.getString());
      }
    } else {
      Serial.print("Error: ");
      Serial.println(http.errorToString(httpResponseCode));
    }
    http.end();
  } else {
    Serial.print("[Cloud Error] Unable to connect to host: ");
    Serial.println(API_URL);
  }
}

// =====================================================================
// CLOUD TELEMETRY
// =====================================================================
void pushCloudTelemetry(float temp, float hum, float weight, bool medicine, int battery = 98) {
  String payload = "{";
  payload += "\"deviceId\":\"ESP32-001\",";
  payload += "\"temperature\":" + String(temp, 1) + ",";
  payload += "\"humidity\":" + String(hum, 1) + ",";
  payload += "\"weight\":" + String(weight, 1) + ",";
  payload += "\"medicinePresent\":" + String(medicine ? "true" : "false") + ",";
  payload += "\"battery\":" + String(battery);
  payload += "}";

  sendApiAction("REPORT_TELEMETRY", payload);
}

// =====================================================================
// CAPTIVE PORTAL - ROOT
// =====================================================================
void handlePortalRoot() {
  int n = WiFi.scanNetworks();
  String options = "";

  if (n == 0) {
    options = "<option disabled>No networks found</option>";
  } else {
    for (int i = 0; i < n; i++) {
      String ssidName = WiFi.SSID(i);
      int rssi = WiFi.RSSI(i);
      options += "<option value='" + ssidName + "'>" + ssidName + " (" + String(rssi) + " dBm)</option>";
    }
  }

  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tesseract Wi-Fi Setup</title>
<style>
* { box-sizing: border-box; }
body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f172a;
    color: #f8fafc;
    margin: 0;
    padding: 24px;
}
.card {
    max-width: 440px;
    margin: 20px auto;
    background: #1e293b;
    border-radius: 16px;
    padding: 28px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.4);
}
h2 {
    margin: 0 0 8px 0;
    font-size: 22px;
    color: #38bdf8;
    text-align: center;
}
p {
    font-size: 14px;
    color: #94a3b8;
    text-align: center;
    margin-bottom: 24px;
}
label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 6px;
    color: #cbd5e1;
}
select, input[type="text"], input[type="password"] {
    width: 100%;
    padding: 12px 14px;
    margin-bottom: 18px;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 8px;
    color: white;
    font-size: 15px;
}
button {
    width: 100%;
    background: #0284c7;
    color: white;
    border: none;
    padding: 14px;
    border-radius: 8px;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
}
.note {
    font-size: 12px;
    color: #64748b;
    text-align: center;
    margin-top: 16px;
}
</style>
</head>
<body>
<div class="card">
<h2>💊 Tesseract IoT Setup</h2>
<p>Select your Wi-Fi network to connect the ESP32 to the global cloud dashboard.</p>
<form action="/save" method="POST">
<label>Available Wi-Fi Networks:</label>
<select name="ssid" id="ssid" onchange="checkCustom(this)">
)rawliteral" + options + R"rawliteral(
<option value="__custom__">+ Enter Hidden / Other Network</option>
</select>
<div id="customDiv" style="display:none;">
<label>Network Name (SSID):</label>
<input type="text" name="custom_ssid" id="custom_ssid" placeholder="Enter Wi-Fi name">
</div>
<label>Wi-Fi Password:</label>
<input type="password" name="password" placeholder="Enter password">
<button type="submit">Connect to Wi-Fi</button>
</form>
<div class="note">Device will reboot and connect automatically.</div>
</div>
<script>
function checkCustom(select) {
    var customDiv = document.getElementById("customDiv");
    customDiv.style.display = (select.value === "__custom__") ? "block" : "none";
}
</script>
</body>
</html>
)rawliteral";

  server.send(200, "text/html", html);
}

// =====================================================================
// SAVE WIFI
// =====================================================================
void handleSaveWifi() {
  String selectedSSID = server.arg("ssid");
  if (selectedSSID == "__custom__") {
    selectedSSID = server.arg("custom_ssid");
  }
  String enteredPass = server.arg("password");

  if (selectedSSID.length() == 0) {
    server.send(400, "text/html", "<h3>Error: Wi-Fi Name cannot be empty.<br><br><a href='/'>Go back</a></h3>");
    return;
  }

  preferences.begin("tesseract", false);
  preferences.putString("ssid", selectedSSID);
  preferences.putString("password", enteredPass);
  preferences.end();

  String html =
      "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
      "<body style='background:#0f172a;color:white;font-family:Arial;text-align:center;padding:40px;'>"
      "<h2 style='color:#22c55e'>Credentials Saved!</h2>"
      "<p>Connecting to <b>" + selectedSSID + "</b>...</p>"
      "<p>ESP32 will restart.</p>"
      "</body></html>";

  server.send(200, "text/html", html);
  delay(2000);
  ESP.restart();
}

// =====================================================================
// ONLINE DASHBOARD
// =====================================================================
void handleOnlineRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tesseract Smart Medicine Monitor</title>
<style>
* { box-sizing: border-box; }
body {
    font-family: Arial, sans-serif;
    background: #0f172a;
    color: white;
    text-align: center;
    margin: 0;
    padding: 24px;
}
.container { max-width: 650px; margin: auto; }
h1 { color: #38bdf8; margin-bottom: 6px; }
.cloud-bar {
    background: #1e293b;
    padding: 10px 16px;
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 13px;
    color: #94a3b8;
}
.cloud-bar a { color: #38bdf8; font-weight: bold; text-decoration: none; }
.grid { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; margin-bottom: 20px; }
.card {
    background: #1e293b;
    padding: 20px;
    border-radius: 12px;
    width: 180px;
    border: 1px solid #334155;
}
.card-title { font-size: 12px; color: #94a3b8; font-weight: bold; text-transform: uppercase; margin-bottom: 8px; }
.card-val { font-size: 28px; font-weight: bold; color: #f8fafc; }
.card-unit { font-size: 14px; color: #64748b; margin-left: 2px; }
.medicine-card { width: 100%; max-width: 480px; background: #1e293b; border-radius: 12px; padding: 22px; margin: 0 auto 20px auto; border: 1px solid #334155; }
.medicine-status { font-size: 20px; font-weight: bold; padding: 10px; border-radius: 8px; margin-top: 8px; }
.medicine-status.present { background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid #22c55e; }
.medicine-status.absent { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid #ef4444; }
.reset-btn {
    background: #334155;
    color: #cbd5e1;
    border: none;
    padding: 10px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 13px;
    margin-top: 10px;
}
.reset-btn:hover { background: #475569; }
</style>
</head>
<body>
<div class="container">
<h1>💊 Tesseract</h1>
<div class="cloud-bar">
Live IoT Cloud: <a href="https://tesseract-med-tracker.vercel.app" target="_blank">Open Global Web Dashboard &rarr;</a>
</div>
<div class="grid">
    <div class="card">
        <div class="card-title">Temperature</div>
        <div class="card-val"><span id="temperature">--</span><span class="card-unit">&deg;C</span></div>
    </div>
    <div class="card">
        <div class="card-title">Humidity</div>
        <div class="card-val"><span id="humidity">--</span><span class="card-unit">%</span></div>
    </div>
</div>
<div class="medicine-card">
    <div class="card-title">Medicine Presence (IR Sensor GPIO 18)</div>
    <div id="medicine" class="medicine-status absent">Checking...</div>
</div>
<div style="font-size: 12px; color: #64748b;" id="update">Connecting...</div>
<form action="/reset-wifi" method="POST" onsubmit="return confirm('Clear Wi-Fi credentials and restart AP setup?');">
    <button type="submit" class="reset-btn">Reset Wi-Fi Settings</button>
</form>
</div>
<script>
function updateData() {
    fetch("/data")
    .then(r => r.json())
    .then(data => {
        document.getElementById("temperature").innerText = Number(data.temperature).toFixed(1);
        document.getElementById("humidity").innerText = Number(data.humidity).toFixed(1);
        var med = document.getElementById("medicine");
        if (data.medicinePresent) {
            med.innerText = "🟢 MEDICINE PRESENT";
            med.className = "medicine-status present";
        } else {
            med.innerText = "🔴 MEDICINE ABSENT";
            med.className = "medicine-status absent";
        }
        document.getElementById("update").innerText = "Last update: " + new Date().toLocaleTimeString();
    })
    .catch(() => {
        document.getElementById("update").innerText = "Device offline or busy";
    });
}
setInterval(updateData, 2000);
updateData();
</script>
</body>
</html>
)rawliteral";

  server.send(200, "text/html", html);
}

// =====================================================================
// SENSOR DATA API
// =====================================================================
void handleData() {
  String json = "{";
  json += "\"temperature\":" + String(temperature, 1) + ",";
  json += "\"humidity\":" + String(humidity, 1) + ",";
  json += "\"weight\":" + String(currentWeight, 1) + ",";
  json += "\"medicinePresent\":" + String(medicinePresent ? "true" : "false") + ",";
  json += "\"rawIrPin18\":" + String(digitalRead(MEDICINE_IR_PIN));
  json += "}";

  server.send(200, "application/json", json);
}

// =====================================================================
// RESET WIFI
// =====================================================================
void handleResetWifi() {
  preferences.begin("tesseract", false);
  preferences.clear();
  preferences.end();

  server.send(200, "text/html", "<h3>Wi-Fi credentials erased.<br>Restarting into AP mode...</h3>");
  delay(2000);
  ESP.restart();
}

// =====================================================================
// START ACCESS POINT MODE
// =====================================================================
void startAccessPointMode() {
  isAPMode = true;
  server.stop();
  delay(100);

  WiFi.disconnect(false);
  delay(300);
  WiFi.mode(WIFI_AP);

  WiFi.softAPConfig(ap_IP, ap_Gateway, ap_Subnet);
  bool apStarted = WiFi.softAP(AP_SSID, AP_PASS);

  if (!apStarted) {
    Serial.println("[AP ERROR] Failed to start Access Point!");
    return;
  }

  Serial.println("\n==================================================");
  Serial.println("   [AP MODE] Tesseract Access Point Started");
  Serial.println("==================================================");
  Serial.print("SSID: "); Serial.println(AP_SSID);
  Serial.print("Password: "); Serial.println(AP_PASS);
  Serial.print("AP IP Address: "); Serial.println(WiFi.softAPIP());
  Serial.println("Connect phone to: Tesseract-Medicine");
  Serial.println("Open browser to: http://192.168.4.1");
  Serial.println("==================================================");

  dnsServer.stop();
  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());

  server.on("/", handlePortalRoot);
  server.on("/save", HTTP_POST, handleSaveWifi);
  server.on("/generate_204", handlePortalRoot); // Android captive portal
  server.on("/hotspot-detect.html", handlePortalRoot); // iOS captive portal
  server.on("/canonical.html", handlePortalRoot);
  server.on("/ncsi.txt", handlePortalRoot); // Windows
  server.onNotFound(handlePortalRoot);

  server.begin();
  Serial.println("[Web Server] Captive portal running on port 80");
}

// =====================================================================
// CONNECT TO SAVED WIFI
// =====================================================================
bool connectToSavedWifi() {
  preferences.begin("tesseract", true);
  savedSSID = preferences.getString("ssid", "");
  savedPassword = preferences.getString("password", "");
  preferences.end();

  if (savedSSID.length() == 0) {
    Serial.println("\n[WiFi] No saved credentials.");
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(savedSSID.c_str(), savedPassword.c_str());

  Serial.print("[WiFi] Connecting to ");
  Serial.println(savedSSID);

  unsigned long startTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected successfully!");
    Serial.print("[WiFi] IP Address: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("\n[WiFi] Failed to connect.");
  WiFi.disconnect(false);
  return false;
}

// =====================================================================
// AUTO-SWITCH BACK TO STATION (CLIENT) MODE FROM AP MODE
// =====================================================================
bool attemptStationReconnect() {
  if (savedSSID.length() == 0) return false;

  // Use AP_STA mode so the captive portal remains running while probing
  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(savedSSID.c_str(), savedPassword.c_str());

  Serial.print("\n[AP Mode] Probing saved network: " + savedSSID);
  unsigned long startProbe = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startProbe < 5000) {
    dnsServer.processNextRequest();
    server.handleClient();
    delay(200);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected to saved Wi-Fi!");
    return true;
  }

  // Not connected yet; restore pure AP mode
  WiFi.disconnect(false);
  WiFi.mode(WIFI_AP);
  Serial.println("\n[WiFi] Network still unavailable. Continuing AP mode.");
  return false;
}

void switchToStationMode() {
  isAPMode = false;
  dnsServer.stop();
  server.stop();
  delay(100);

  WiFi.mode(WIFI_STA);

  server.on("/", handleOnlineRoot);
  server.on("/data", handleData);
  server.on("/reset-wifi", HTTP_POST, handleResetWifi);
  server.begin();

  Serial.println("\n==================================================");
  Serial.println("  [WiFi] Switched back to Client Mode! IP: " + WiFi.localIP().toString());
  Serial.println("==================================================");

  // Push immediate telemetry update to Vercel
  pushCloudTelemetry(temperature, humidity, currentWeight, medicinePresent, 100);
}

// =====================================================================
// SETUP
// =====================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==================================================");
  Serial.println("     TESSERACT SMART MEDICINE MONITOR (IoT)       ");
  Serial.println("==================================================");

  // 1. Initialize DHT11
  dht.begin();
  Serial.println("[Sensors] DHT11 initialized on GPIO 4");

  // 2. Initialize Medicine IR Sensor
#if ENABLE_MEDICINE_IR
  pinMode(MEDICINE_IR_PIN, INPUT);
  int initialRaw = digitalRead(MEDICINE_IR_PIN);
  medicinePresent = (initialRaw == IR_ACTIVE_STATE);
  lastMedicinePresent = medicinePresent;

  Serial.print("[Sensors] Medicine IR sensor active on GPIO 18 (Active Polarity: ");
  Serial.print(IR_ACTIVE_STATE == HIGH ? "HIGH" : "LOW");
  Serial.print(" | Current Raw: ");
  Serial.print(initialRaw);
  Serial.print(" -> State: ");
  Serial.println(medicinePresent ? "PRESENT" : "ABSENT");
#endif

  // 3. Optional Weight Sensor (HX711)
#if ENABLE_WEIGHT_SENSOR
  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(2280.f);
  scale.tare();
  if (scale.is_ready()) {
    currentWeight = scale.get_units(5);
  }
  Serial.println("[Sensors] HX711 active on GPIO 32/33");
#else
  Serial.println("[Sensors] HX711 disabled");
#endif

  // 4. Load saved credentials
  preferences.begin("tesseract", true);
  savedSSID = preferences.getString("ssid", "");
  savedPassword = preferences.getString("password", "");
  preferences.end();

  // 5. Connect to Wi-Fi or start AP
  if (!connectToSavedWifi()) {
    startAccessPointMode();
  } else {
    server.on("/", handleOnlineRoot);
    server.on("/data", handleData);
    server.on("/reset-wifi", HTTP_POST, handleResetWifi);
    server.begin();
    Serial.println("[Web Server] Local dashboard started.");

    // Initial DHT reading
    float initT = dht.readTemperature();
    float initH = dht.readHumidity();
    if (!isnan(initT) && !isnan(initH)) {
      temperature = initT;
      humidity = initH;
    }

    // Initial cloud telemetry push
    pushCloudTelemetry(temperature, humidity, currentWeight, medicinePresent, 100);
  }
}

// =====================================================================
// MAIN LOOP
// =====================================================================
void loop() {
  // -------------------------------------------------------------------
  // AP MODE
  // -------------------------------------------------------------------
  if (isAPMode) {
    dnsServer.processNextRequest();
    server.handleClient();

    unsigned long currentMillis = millis();

    // Check IR sensor even in AP mode
#if ENABLE_MEDICINE_IR
    int rawIr = digitalRead(MEDICINE_IR_PIN);
    bool currentMedicinePresent = (rawIr == IR_ACTIVE_STATE);
    if (currentMedicinePresent != lastMedicinePresent) {
      delay(40); // Debounce
      if ((digitalRead(MEDICINE_IR_PIN) == IR_ACTIVE_STATE) == currentMedicinePresent) {
        medicinePresent = currentMedicinePresent;
        Serial.printf("[Medicine IR] Raw Pin 18: %d -> MEDICINE %s\n", rawIr, medicinePresent ? "PRESENT" : "ABSENT");
        lastMedicinePresent = medicinePresent;
      }
    }
#endif

    // Read DHT11
    if (currentMillis - lastSensorRead >= SENSOR_READ_INTERVAL_MS) {
      float newT = dht.readTemperature();
      float newH = dht.readHumidity();
      if (!isnan(newT) && !isnan(newH)) {
        temperature = newT;
        humidity = newH;
      }
      lastSensorRead = currentMillis;
    }

    // Periodically probe if saved Wi-Fi is back online (every 15s)
    static unsigned long lastStationProbe = 0;
    const unsigned long STATION_PROBE_INTERVAL_MS = 15000;

    if (savedSSID.length() > 0 && currentMillis - lastStationProbe >= STATION_PROBE_INTERVAL_MS) {
      lastStationProbe = currentMillis;
      if (attemptStationReconnect()) {
        switchToStationMode();
        return;
      }
    }

    delay(5);
    return;
  }

  // -------------------------------------------------------------------
  // ONLINE MODE
  // -------------------------------------------------------------------
  server.handleClient();

  // Wi-Fi Connection Loss Handling
  if (WiFi.status() != WL_CONNECTED) {
    if (!wifiReconnecting) {
      wifiReconnecting = true;
      wifiDisconnectStart = millis();
      lastReconnectAttempt = 0;
      Serial.println("\n[WiFi] Connection lost. Attempting reconnection...");
      WiFi.reconnect();
    }

    unsigned long disconnectedFor = millis() - wifiDisconnectStart;
    if (disconnectedFor < WIFI_RECONNECT_TIMEOUT_MS) {
      if (millis() - lastReconnectAttempt >= WIFI_RECONNECT_INTERVAL_MS) {
        lastReconnectAttempt = millis();
        Serial.printf("[WiFi] Reconnecting... %lu seconds\n", disconnectedFor / 1000);
        WiFi.reconnect();
      }
      delay(10);
      return;
    }

    Serial.println("\n[WiFi] Reconnection timeout. Switching to AP mode...");
    wifiReconnecting = false;
    startAccessPointMode();
    return;
  }

  if (wifiReconnecting) {
    wifiReconnecting = false;
    Serial.println("\n[WiFi] Connection restored! IP: " + WiFi.localIP().toString());
  }

  unsigned long currentMillis = millis();

  // 1. Read DHT11 & IR Pin every 2 seconds
  if (currentMillis - lastSensorRead >= SENSOR_READ_INTERVAL_MS) {
    float newT = dht.readTemperature();
    float newH = dht.readHumidity();
    if (!isnan(newT) && !isnan(newH)) {
      temperature = newT;
      humidity = newH;
      int rawIr = digitalRead(MEDICINE_IR_PIN);
      Serial.printf("[Sensors] Temp: %.1f °C | Humidity: %.1f %% | Pin 18 Raw: %d (Medicine: %s)\n",
                    temperature, humidity, rawIr, medicinePresent ? "PRESENT" : "ABSENT");
    } else {
      Serial.println("[DHT11] Warning: Read failed");
    }
    lastSensorRead = currentMillis;
  }

  // 2. Read Medicine IR Sensor with Debounce
#if ENABLE_MEDICINE_IR
  int rawIr = digitalRead(MEDICINE_IR_PIN);
  bool currentMedicinePresent = (rawIr == IR_ACTIVE_STATE);

  if (currentMedicinePresent != lastMedicinePresent) {
    delay(40); // 40ms debounce to filter transient optical jitter
    if ((digitalRead(MEDICINE_IR_PIN) == IR_ACTIVE_STATE) == currentMedicinePresent) {
      medicinePresent = currentMedicinePresent;
      Serial.printf("\n[Medicine IR] Raw Pin 18: %d -> MEDICINE %s\n", rawIr, medicinePresent ? "PRESENT" : "ABSENT");

      if (medicinePresent) {
        sendApiAction("MEDICINE_PRESENT", "{\"deviceId\":\"ESP32-001\",\"compartmentId\":\"A1\"}");
      } else {
        sendApiAction("MEDICINE_ABSENT", "{\"deviceId\":\"ESP32-001\",\"compartmentId\":\"A1\"}");
      }
      lastMedicinePresent = medicinePresent;
    }
  }
#endif

  // 3. Optional Weight Sensor (HX711)
#if ENABLE_WEIGHT_SENSOR
  if (scale.is_ready()) {
    currentWeight = scale.get_units(3);
  }
#endif

  // 4. Cloud Telemetry Push every 3 seconds (Ping interval = 3s)
  if (currentMillis - lastCloudSync >= CLOUD_SYNC_INTERVAL_MS) {
    if (temperature > 0.0 || humidity > 0.0) {
      Serial.println("\n[Cloud] Pushing live telemetry (3s interval)...");
      pushCloudTelemetry(temperature, humidity, currentWeight, medicinePresent, 98);
    }
    lastCloudSync = currentMillis;
  }

  delay(10);
}
