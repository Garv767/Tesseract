#include <WiFi.h>
#include <WiFiMulti.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <DHT.h>

// =====================================================================
// SENSOR 1 & 2: DHT11 (Temperature & Humidity) - CURRENTLY ACTIVE
// =====================================================================
#define DHT_PIN 4
#define DHT_TYPE DHT11

DHT dht(DHT_PIN, DHT_TYPE);

// =====================================================================
// PLACEHOLDER: SENSORS PLANNED FOR FUTURE HARDWARE TESTING
// Set to 1 when you physically wire each sensor.
// =====================================================================
#define ENABLE_DOOR_SENSOR   0 // Set to 1 when Reed switch is connected to PIN 18
#define ENABLE_WEIGHT_SENSOR 0 // Set to 1 when HX711 load cell is connected to DT 32, SCK 33

#if ENABLE_DOOR_SENSOR
  #define DOOR_SENSOR_PIN 18 // Reed Switch pin
#endif

#if ENABLE_WEIGHT_SENSOR
  #include "HX711.h"
  #define HX711_DT 32
  #define HX711_SCK 33
  HX711 scale;
  const float medicineThreshold = 10.0;
#endif

// =====================================================================
// WIFI CONFIGURATION (WiFiMulti & Optional WiFiManager)
// Automatically connects to your home Wi-Fi or phone hotspot
// =====================================================================
WiFiMulti wifiMulti;

#define USE_WIFIMANAGER 0
#if USE_WIFIMANAGER
  #include <WiFiManager.h>
#endif

// =====================================================================
// GLOBAL CLOUD API CONFIGURATION (Vercel Production)
// =====================================================================
const char* API_URL = "https://tesseract-med-tracker.vercel.app/api/action";

// =====================================================================
// LOCAL WEB SERVER (For direct local IP monitoring)
// =====================================================================
WebServer server(80);

// Current sensor readings
float temperature = 0.0;
float humidity = 0.0;
float currentWeight = 50.0; // Simulated/placeholder weight (50g) until HX711 is attached
bool doorOpen = false;      // Simulated/placeholder door state (closed) until Reed switch is attached
float lastWeight = 50.0;
bool lastDoorState = false;

// Cloud telemetry sync timers
unsigned long lastSensorRead = 0;
const unsigned long SENSOR_READ_INTERVAL_MS = 2000;   // Read DHT11 every 2 seconds
unsigned long lastCloudSync = 0;
const unsigned long CLOUD_SYNC_INTERVAL_MS = 10000;   // Push to Vercel cloud every 10 seconds

// =====================================================================
// LOCAL WEB SERVER HANDLERS
// =====================================================================
void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smart Medicine Monitor - Global ESP32</title>
<style>
body {
    font-family: Arial, sans-serif;
    background: #111827;
    color: white;
    text-align: center;
    margin: 0;
    padding: 30px;
}
h1 { margin-bottom: 10px; }
.subtitle { color: #9ca3af; margin-bottom: 25px; font-size: 14px; }
.cloud-link { color: #38bdf8; text-decoration: none; font-weight: bold; }
.cloud-link:hover { text-decoration: underline; }
.container { max-width: 700px; margin: auto; }
.cards {
    display: flex;
    gap: 20px;
    justify-content: center;
    flex-wrap: wrap;
}
.card {
    background: #1f2937;
    border-radius: 15px;
    padding: 25px;
    width: 200px;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
}
.title { color: #9ca3af; font-size: 16px; }
.value { font-size: 44px; font-weight: bold; margin-top: 10px; }
.unit { font-size: 20px; color: #9ca3af; }
.status {
    margin-top: 25px;
    color: #22c55e;
    font-size: 17px;
}
.info { color: #6b7280; font-size: 13px; margin-top: 8px; }
</style>
</head>
<body>
<div class="container">
<h1>🌡️ Smart Medicine Monitor</h1>
<p class="subtitle">Local Node | Syncing with <a class="cloud-link" href="https://tesseract-med-tracker.vercel.app" target="_blank">Tesseract Cloud</a></p>

<div class="cards">
  <div class="card">
    <div class="title">Temperature</div>
    <div class="value"><span id="temperature">--</span><span class="unit">°C</span></div>
  </div>
  <div class="card">
    <div class="title">Humidity</div>
    <div class="value"><span id="humidity">--</span><span class="unit">%</span></div>
  </div>
  <div class="card">
    <div class="title">Weight (Planned)</div>
    <div class="value"><span id="weight">50.0</span><span class="unit">g</span></div>
  </div>
</div>

<div class="status">🟢 ESP32 ONLINE &amp; CLOUD CONNECTED</div>
<p id="update" class="info">Waiting for sensor...</p>
</div>

<script>
function updateSensorData() {
    fetch("/data")
    .then(response => response.json())
    .then(data => {
        document.getElementById("temperature").innerText = data.temperature.toFixed(1);
        document.getElementById("humidity").innerText = data.humidity.toFixed(1);
        if (data.weight !== undefined) {
            document.getElementById("weight").innerText = data.weight.toFixed(1);
        }
        document.getElementById("update").innerText = "Last update: " + new Date().toLocaleTimeString();
    })
    .catch(error => {
        document.getElementById("update").innerText = "Local read error";
    });
}
setInterval(updateSensorData, 2000);
updateSensorData();
</script>
</body>
</html>
)rawliteral";

  server.send(200, "text/html", html);
}

void handleData() {
  String json = "{";
  json += "\"temperature\":" + String(temperature, 1) + ",";
  json += "\"humidity\":" + String(humidity, 1) + ",";
  json += "\"weight\":" + String(currentWeight, 1) + ",";
  json += "\"doorOpen\":" + String(doorOpen ? "true" : "false");
  json += "}";

  server.send(200, "application/json", json);
}

// =====================================================================
// GLOBAL HTTPS API DISPATCHER (Sends to Vercel Cloud)
// =====================================================================
void sendApiAction(String action, String payload) {
  if (WiFi.status() != WL_CONNECTED) {
#if !USE_WIFIMANAGER
    wifiMulti.run();
#endif
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[Cloud Error] Wi-Fi not connected. Cannot reach Vercel.");
      return;
    }
  }

  WiFiClientSecure client;
  client.setInsecure(); // Connect to HTTPS without requiring hardcoded CA certificates

  HTTPClient http;
  http.setTimeout(8000); // 8 second timeout

  if (http.begin(client, API_URL)) {
    http.addHeader("Content-Type", "application/json");

    String requestBody = "{\"action\":\"" + action + "\", \"payload\":" + payload + "}";
    Serial.print("[Cloud API] POST " + action + "... ");

    int httpResponseCode = http.POST(requestBody);

    if (httpResponseCode > 0) {
      Serial.println("Code: " + String(httpResponseCode));
      if (httpResponseCode == 200) {
        Serial.println("  Cloud response: " + http.getString());
      } else {
        Serial.println("  Cloud warning: " + http.getString());
      }
    } else {
      Serial.println("Error: " + http.errorToString(httpResponseCode));
    }
    http.end();
  } else {
    Serial.println("[Cloud Error] Unable to connect to " + String(API_URL));
  }
}

// Push complete telemetry snapshot to the cloud
void pushCloudTelemetry(float temp, float hum, float weight, bool door, int battery = 98) {
  String payload = "{";
  payload += "\"temperature\":" + String(temp, 1) + ",";
  payload += "\"humidity\":" + String(hum, 1) + ",";
  payload += "\"weight\":" + String(weight, 1) + ",";
  payload += "\"doorOpen\":" + String(door ? "true" : "false") + ",";
  payload += "\"battery\":" + String(battery);
  payload += "}";

  sendApiAction("REPORT_TELEMETRY", payload);
}

// =====================================================================
// WIFI INITIALIZATION
// =====================================================================
void setupWiFi() {
#if USE_WIFIMANAGER
  Serial.println("\n[WiFi] Starting WiFiManager captive portal...");
  WiFiManager wm;
  bool res = wm.autoConnect("Tesseract-Setup", "12345678");
  if (!res) {
    Serial.println("[WiFi] Portal timeout. Restarting...");
    ESP.restart();
  }
#else
  WiFi.mode(WIFI_STA);
  Serial.println("\n[WiFi] Initializing multi-network auto-connect...");

  // Enter your home/lab Wi-Fi and phone hotspot credentials here:
  wifiMulti.addAP("YOUR_WIFI_NAME", "YOUR_WIFI_PASSWORD");
  wifiMulti.addAP("YOUR_PHONE_HOTSPOT", "HOTSPOT_PASSWORD");

  Serial.print("[WiFi] Connecting");
  int attempts = 0;
  while (wifiMulti.run() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected!");
    Serial.print("[WiFi] Local IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("[WiFi] Connected to SSID: ");
    Serial.println(WiFi.SSID());
  } else {
    Serial.println("\n[WiFi] Warning: Still searching for Wi-Fi. Will retry in loop.");
  }
#endif
}

// =====================================================================
// SETUP
// =====================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("==================================================");
  Serial.println("   TESSERACT SMART MEDICINE MONITOR (GLOBAL IoT)  ");
  Serial.println("==================================================");

  // 1. Initialize Active Sensors (DHT11 on Pin 4)
  dht.begin();
  Serial.println("[Sensors] DHT11 initialized on GPIO 4");

  // 2. Initialize Planned Sensors (Placeholder Logic)
#if ENABLE_DOOR_SENSOR
  pinMode(DOOR_SENSOR_PIN, INPUT_PULLUP);
  doorOpen = (digitalRead(DOOR_SENSOR_PIN) == HIGH);
  lastDoorState = doorOpen;
  Serial.println("[Sensors] Reed switch active on GPIO 18");
#else
  Serial.println("[Sensors] Door Reed Switch: DISABLED (Placeholder mode)");
#endif

#if ENABLE_WEIGHT_SENSOR
  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(2280.f);
  scale.tare();
  if (scale.is_ready()) {
    currentWeight = scale.get_units(5);
    lastWeight = currentWeight;
  }
  Serial.println("[Sensors] HX711 load cell active on GPIO 32/33");
#else
  Serial.println("[Sensors] HX711 Load Cell: DISABLED (Placeholder mode - 50.0g default)");
#endif

  // 3. Connect to Wi-Fi
  setupWiFi();

  // 4. Start Local Web Server
  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.begin();
  Serial.println("[Web Server] Local monitor started on port 80");

  // 5. Initial Boot Telemetry Push
  float initTemp = dht.readTemperature();
  float initHum = dht.readHumidity();
  if (!isnan(initTemp) && !isnan(initHum)) {
    temperature = initTemp;
    humidity = initHum;
  }
  pushCloudTelemetry(temperature, humidity, currentWeight, doorOpen, 100);
}

// =====================================================================
// MAIN LOOP
// =====================================================================
void loop() {
  // Handle local web page client requests
  server.handleClient();

  // Ensure Wi-Fi auto-reconnects if disconnected
#if !USE_WIFIMANAGER
  if (WiFi.status() != WL_CONNECTED) {
    wifiMulti.run();
  }
#endif

  unsigned long currentMillis = millis();

  // -------------------------------------------------------------------
  // 1. Read DHT11 (Every 2 Seconds, Non-blocking)
  // -------------------------------------------------------------------
  if (currentMillis - lastSensorRead >= SENSOR_READ_INTERVAL_MS) {
    float newTemperature = dht.readTemperature();
    float newHumidity = dht.readHumidity();

    if (!isnan(newTemperature) && !isnan(newHumidity)) {
      temperature = newTemperature;
      humidity = newHumidity;

      Serial.print("[DHT11] Temp: ");
      Serial.print(temperature, 1);
      Serial.print(" °C | Humidity: ");
      Serial.print(humidity, 1);
      Serial.println(" %");
    } else {
      Serial.println("[DHT11] Warning: Read failed");
    }

    lastSensorRead = currentMillis;
  }

  // -------------------------------------------------------------------
  // 2. Door Sensor Check (Placeholder - Active if ENABLE_DOOR_SENSOR = 1)
  // -------------------------------------------------------------------
#if ENABLE_DOOR_SENSOR
  bool currentDoorState = (digitalRead(DOOR_SENSOR_PIN) == HIGH);
  if (currentDoorState != lastDoorState) {
    doorOpen = currentDoorState;
    if (doorOpen) {
      Serial.println("[Event] Door Opened!");
      sendApiAction("OPEN_DOOR", "{}");
    } else {
      Serial.println("[Event] Door Closed.");
      sendApiAction("CLOSE_DOOR", "{}");
    }
    lastDoorState = currentDoorState;
  }
#endif

  // -------------------------------------------------------------------
  // 3. Weight Sensor Check (Placeholder - Active if ENABLE_WEIGHT_SENSOR = 1)
  // -------------------------------------------------------------------
#if ENABLE_WEIGHT_SENSOR
  if (scale.is_ready()) {
    float readWeight = scale.get_units(3);
    currentWeight = readWeight;

    if (lastWeight > medicineThreshold && currentWeight <= medicineThreshold) {
      Serial.println("[Event] Medicine Removed!");
      sendApiAction("REMOVE_MEDICINE", "{\"compartmentId\":\"A1\"}");
    } else if (lastWeight <= medicineThreshold && currentWeight > medicineThreshold) {
      Serial.println("[Event] Medicine Restored.");
      sendApiAction("RESTORE_MEDICINE", "{\"compartmentId\":\"A1\"}");
    }
    lastWeight = currentWeight;
  }
#endif

  // -------------------------------------------------------------------
  // 4. Global Cloud Telemetry Push (Every 10 Seconds)
  // Sends live readings to https://tesseract-med-tracker.vercel.app/api/action
  // -------------------------------------------------------------------
  if (currentMillis - lastCloudSync >= CLOUD_SYNC_INTERVAL_MS) {
    if (temperature > 0.0 || humidity > 0.0) {
      Serial.println("[Cloud] Pushing live telemetry to global Vercel API...");
      pushCloudTelemetry(temperature, humidity, currentWeight, doorOpen, 98);
    }
    lastCloudSync = currentMillis;
  }

  // Small delay for watchdog / CPU yield
  delay(10);
}
