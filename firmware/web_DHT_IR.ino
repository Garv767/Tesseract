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
// Default assumption:
// LOW  = Medicine PRESENT
// HIGH = Medicine ABSENT
//
// If your IR sensor behaves opposite, change IR_ACTIVE_STATE
// from LOW to HIGH.

#define ENABLE_MEDICINE_IR 1

#define MEDICINE_IR_PIN 18

#define IR_ACTIVE_STATE LOW


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

const char* API_URL =
    "https://tesseract-med-tracker.vercel.app/api/action";


// =====================================================================
// ACCESS POINT CONFIGURATION
// =====================================================================

const char* AP_SSID =
    "Tesseract-Medicine";

const char* AP_PASS =
    "12345678";

IPAddress ap_IP(
    192,
    168,
    4,
    1
);

IPAddress ap_Gateway(
    192,
    168,
    4,
    1
);

IPAddress ap_Subnet(
    255,
    255,
    255,
    0
);


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

const unsigned long WIFI_RECONNECT_TIMEOUT_MS =
    10000;

const unsigned long WIFI_RECONNECT_INTERVAL_MS =
    2000;


// =====================================================================
// SENSOR VARIABLES
// =====================================================================

float temperature = 0.0;

float humidity = 0.0;

float currentWeight = 50.0;


// Medicine status
//
// true  = medicine present
// false = medicine absent

bool medicinePresent = false;

bool lastMedicinePresent = false;


// =====================================================================
// SENSOR TIMERS
// =====================================================================

unsigned long lastSensorRead = 0;

const unsigned long SENSOR_READ_INTERVAL_MS =
    2000;


// =====================================================================
// CLOUD SYNC TIMER
// =====================================================================

unsigned long lastCloudSync = 0;

const unsigned long CLOUD_SYNC_INTERVAL_MS =
    10000;


// =====================================================================
// CLOUD API DISPATCHER
// =====================================================================

void sendApiAction(
    String action,
    String payload
) {

    // ---------------------------------------------------------------
    // Check Wi-Fi
    // ---------------------------------------------------------------

    if (WiFi.status() != WL_CONNECTED) {

        Serial.println(
            "[Cloud Error] Wi-Fi disconnected. Cannot send data."
        );

        return;
    }


    // ---------------------------------------------------------------
    // HTTPS client
    // ---------------------------------------------------------------

    WiFiClientSecure client;

    client.setInsecure();


    // ---------------------------------------------------------------
    // HTTP
    // ---------------------------------------------------------------

    HTTPClient http;

    http.setTimeout(8000);


    if (
        http.begin(
            client,
            API_URL
        )
    ) {

        http.addHeader(
            "Content-Type",
            "application/json"
        );


        String requestBody =
            "{\"action\":\"" +
            action +
            "\",\"payload\":" +
            payload +
            "}";


        Serial.print(
            "[Cloud API] POST "
        );

        Serial.print(action);

        Serial.print(
            "... "
        );


        int httpResponseCode =
            http.POST(requestBody);


        if (
            httpResponseCode > 0
        ) {

            Serial.print(
                "Code: "
            );

            Serial.println(
                httpResponseCode
            );


            if (
                httpResponseCode == 200
            ) {

                Serial.print(
                    "  Cloud response: "
                );

                Serial.println(
                    http.getString()
                );

            } else {

                Serial.print(
                    "  Cloud response: "
                );

                Serial.println(
                    http.getString()
                );
            }

        } else {

            Serial.print(
                "Error: "
            );

            Serial.println(
                http.errorToString(
                    httpResponseCode
                )
            );
        }


        http.end();

    } else {

        Serial.print(
            "[Cloud Error] Unable to connect to host: "
        );

        Serial.println(
            API_URL
        );
    }
}


// =====================================================================
// CLOUD TELEMETRY
// =====================================================================

void pushCloudTelemetry(
    float temp,
    float hum,
    float weight,
    bool medicine,
    int battery = 98
) {

    String payload = "{";


    payload +=
        "\"temperature\":" +
        String(
            temp,
            1
        );


    payload += ",";


    payload +=
        "\"humidity\":" +
        String(
            hum,
            1
        );


    payload += ",";


    payload +=
        "\"weight\":" +
        String(
            weight,
            1
        );


    payload += ",";


    payload +=
        "\"medicinePresent\":" +
        String(
            medicine
                ? "true"
                : "false"
        );


    payload += ",";


    payload +=
        "\"battery\":" +
        String(
            battery
        );


    payload += "}";


    sendApiAction(
        "REPORT_TELEMETRY",
        payload
    );
}


// =====================================================================
// CAPTIVE PORTAL - ROOT
// =====================================================================

void handlePortalRoot() {

    // ---------------------------------------------------------------
    // Scan Wi-Fi networks
    // ---------------------------------------------------------------

    int n =
        WiFi.scanNetworks();


    String options = "";


    if (
        n == 0
    ) {

        options =
            "<option disabled>"
            "No networks found"
            "</option>";

    } else {

        for (
            int i = 0;
            i < n;
            i++
        ) {

            String ssidName =
                WiFi.SSID(i);


            int rssi =
                WiFi.RSSI(i);


            options +=
                "<option value='" +
                ssidName +
                "'>" +
                ssidName +
                " (" +
                String(rssi) +
                " dBm)" +
                "</option>";
        }
    }


    // ---------------------------------------------------------------
    // HTML
    // ---------------------------------------------------------------

    String html = R"rawliteral(

<!DOCTYPE html>

<html>

<head>

<meta name="viewport"
content="width=device-width, initial-scale=1">

<title>
Tesseract Wi-Fi Setup
</title>

<style>

* {
    box-sizing: border-box;
}

body {

    font-family:
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        Roboto,
        sans-serif;

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

    box-shadow:
        0 10px 25px
        rgba(0,0,0,0.4);
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

select,
input[type="text"],
input[type="password"] {

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

<h2>
💊 Tesseract IoT Setup
</h2>

<p>
Select your Wi-Fi network to connect
the ESP32 to the global cloud dashboard.
</p>


<form
action="/save"
method="POST"
>


<label>
Available Wi-Fi Networks:
</label>


<select
name="ssid"
id="ssid"
onchange="checkCustom(this)"
>

)rawliteral"

+ options +

R"rawliteral(

<option value="__custom__">
+ Enter Hidden / Other Network
</option>

</select>


<div
id="customDiv"
style="display:none;"
>

<label>
Network Name (SSID):
</label>

<input
type="text"
name="custom_ssid"
id="custom_ssid"
placeholder="Enter Wi-Fi name"
>

</div>


<label>
Wi-Fi Password:
</label>

<input
type="password"
name="password"
placeholder="Enter password"
>


<button
type="submit"
>
Connect to Wi-Fi
</button>


</form>


<div class="note">

Device will reboot and
connect automatically.

</div>


</div>


<script>

function checkCustom(select) {

    var customDiv =
        document.getElementById(
            "customDiv"
        );

    if (
        select.value === "__custom__"
    ) {

        customDiv.style.display =
            "block";

    } else {

        customDiv.style.display =
            "none";
    }
}

</script>


</body>

</html>

)rawliteral";


    server.send(
        200,
        "text/html",
        html
    );
}


// =====================================================================
// SAVE WIFI
// =====================================================================

void handleSaveWifi() {

    String selectedSSID =
        server.arg("ssid");


    if (
        selectedSSID ==
        "__custom__"
    ) {

        selectedSSID =
            server.arg(
                "custom_ssid"
            );
    }


    String enteredPass =
        server.arg(
            "password"
        );


    if (
        selectedSSID.length() == 0
    ) {

        server.send(
            400,
            "text/html",
            "<h3>"
            "Error: Wi-Fi Name cannot be empty."
            "<br><br>"
            "<a href='/'>Go back</a>"
            "</h3>"
        );

        return;
    }


    // ---------------------------------------------------------------
    // Save credentials
    // ---------------------------------------------------------------

    preferences.begin(
        "tesseract",
        false
    );


    preferences.putString(
        "ssid",
        selectedSSID
    );


    preferences.putString(
        "password",
        enteredPass
    );


    preferences.end();


    // ---------------------------------------------------------------
    // Response
    // ---------------------------------------------------------------

    String html =

        "<html>"
        "<head>"
        "<meta name='viewport' "
        "content='width=device-width,initial-scale=1'>"
        "</head>"
        "<body style='"
        "background:#0f172a;"
        "color:white;"
        "font-family:Arial;"
        "text-align:center;"
        "padding:40px;"
        "'>"

        "<h2 style='color:#22c55e'>"
        "Credentials Saved!"
        "</h2>"

        "<p>"
        "Connecting to <b>" +
        selectedSSID +
        "</b>..."
        "</p>"

        "<p>"
        "ESP32 will restart."
        "</p>"

        "</body>"
        "</html>";


    server.send(
        200,
        "text/html",
        html
    );


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

<meta
name="viewport"
content="width=device-width, initial-scale=1"
>

<title>
Tesseract Smart Medicine Monitor
</title>


<style>

* {
    box-sizing: border-box;
}

body {

    font-family:
        Arial,
        sans-serif;

    background:
        #0f172a;

    color:
        white;

    margin:
        0;

    padding:
        20px;
}

.container {

    max-width:
        900px;

    margin:
        auto;
}

.header {

    text-align:
        center;

    margin-bottom:
        30px;
}

.header h1 {

    font-size:
        28px;

    margin-bottom:
        8px;
}

.subtitle {

    color:
        #94a3b8;

    font-size:
        14px;
}

.connection {

    display:
        inline-block;

    margin-top:
        12px;

    padding:
        8px 15px;

    border-radius:
        20px;

    background:
        #064e3b;

    color:
        #34d399;

    font-size:
        13px;
}

.cards {

    display:
        grid;

    grid-template-columns:
        repeat(
            auto-fit,
            minmax(200px, 1fr)
        );

    gap:
        20px;
}

.card {

    background:
        #1e293b;

    border-radius:
        18px;

    padding:
        25px;

    text-align:
        center;

    box-shadow:
        0 10px 25px
        rgba(0,0,0,0.25);
}

.title {

    color:
        #94a3b8;

    font-size:
        15px;

    margin-bottom:
        12px;
}

.value {

    font-size:
        40px;

    font-weight:
        bold;
}

.unit {

    font-size:
        18px;

    color:
        #94a3b8;
}

.medicine {

    margin-top:
        20px;

    padding:
        25px;

    border-radius:
        18px;

    background:
        #1e293b;

    text-align:
        center;
}

.medicine-status {

    font-size:
        25px;

    font-weight:
        bold;

    margin-top:
        10px;
}

.present {

    color:
        #22c55e;
}

.absent {

    color:
        #ef4444;
}

.status {

    margin-top:
        25px;

    color:
        #22c55e;

    font-size:
        17px;

    text-align:
        center;
}

.update {

    color:
        #64748b;

    font-size:
        13px;

    text-align:
        center;

    margin-top:
        10px;
}

.reset-btn {

    margin-top:
        30px;

    background:
        #dc2626;

    color:
        white;

    border:
        none;

    padding:
        10px 18px;

    border-radius:
        8px;

    cursor:
        pointer;

    font-size:
        14px;
}

</style>

</head>


<body>


<div class="container">


<div class="header">

<h1>
💊 Tesseract Medicine Monitor
</h1>

<div class="subtitle">

Connected to:
<strong>
)rawliteral"

+ WiFi.SSID() +

R"rawliteral(

</strong>

</div>


<div class="connection">

🟢 ONLINE & CLOUD CONNECTED

</div>

</div>


<div class="cards">


<div class="card">

<div class="title">
🌡 Temperature
</div>

<div class="value">

<span id="temperature">
--
</span>

<span class="unit">
°C
</span>

</div>

</div>


<div class="card">

<div class="title">
💧 Humidity
</div>

<div class="value">

<span id="humidity">
--
</span>

<span class="unit">
%
</span>

</div>

</div>


<div class="card">

<div class="title">
⚖️ Weight
</div>

<div class="value">

<span id="weight">
50.0
</span>

<span class="unit">
g
</span>

</div>

</div>


</div>


<div class="medicine">

<div class="title">
💊 Medicine Status
</div>

<div
id="medicine"
class="medicine-status"
>

Checking...

</div>

</div>


<div class="status">

🟢 ESP32 ONLINE

</div>


<p
id="update"
class="update"
>

Waiting for sensor data...

</p>


<form
action="/reset-wifi"
method="POST"
onsubmit="
return confirm(
'Forget saved Wi-Fi and return to setup mode?'
);
"
>

<button
class="reset-btn"
type="submit"
>

Change Wi-Fi Network

</button>

</form>


</div>


<script>


function updateData() {

    fetch("/data")

    .then(
        response =>
            response.json()
    )

    .then(
        data => {


            document
                .getElementById(
                    "temperature"
                )
                .innerText =
                data.temperature
                    .toFixed(1);


            document
                .getElementById(
                    "humidity"
                )
                .innerText =
                data.humidity
                    .toFixed(1);


            document
                .getElementById(
                    "weight"
                )
                .innerText =
                data.weight
                    .toFixed(1);


            var medicine =
                document
                .getElementById(
                    "medicine"
                );


            if (
                data.medicinePresent
            ) {

                medicine.innerText =
                    "🟢 MEDICINE PRESENT";

                medicine.className =
                    "medicine-status present";

            } else {

                medicine.innerText =
                    "🔴 MEDICINE ABSENT";

                medicine.className =
                    "medicine-status absent";
            }


            document
                .getElementById(
                    "update"
                )
                .innerText =
                "Last update: " +
                new Date()
                    .toLocaleTimeString();

        }
    )

    .catch(
        error => {

            document
                .getElementById(
                    "update"
                )
                .innerText =
                "Connection error";

        }
    );
}


setInterval(
    updateData,
    2000
);


updateData();

</script>


</body>

</html>

)rawliteral";


    server.send(
        200,
        "text/html",
        html
    );
}


// =====================================================================
// SENSOR DATA API
// =====================================================================

void handleData() {

    String json = "{";


    json +=
        "\"temperature\":" +
        String(
            temperature,
            1
        );


    json += ",";


    json +=
        "\"humidity\":" +
        String(
            humidity,
            1
        );


    json += ",";


    json +=
        "\"weight\":" +
        String(
            currentWeight,
            1
        );


    json += ",";


    json +=
        "\"medicinePresent\":" +
        String(
            medicinePresent
                ? "true"
                : "false"
        );


    json += "}";


    server.send(
        200,
        "application/json",
        json
    );
}


// =====================================================================
// RESET WIFI
// =====================================================================

void handleResetWifi() {

    preferences.begin(
        "tesseract",
        false
    );


    preferences.clear();


    preferences.end();


    server.send(
        200,
        "text/html",
        "<h3>"
        "Wi-Fi credentials erased."
        "<br>"
        "Restarting into AP mode..."
        "</h3>"
    );


    delay(2000);


    ESP.restart();
}


// =====================================================================
// START ACCESS POINT MODE
// =====================================================================

void startAccessPointMode() {

    // ================================================================
    // Mark AP mode
    // ================================================================

    isAPMode = true;


    // ================================================================
    // Stop current web server
    // ================================================================

    server.stop();

    delay(100);


    // ================================================================
    // Switch ESP32 to Access Point mode
    // ================================================================

    WiFi.disconnect(false);

    delay(300);

    WiFi.mode(WIFI_AP);


    // ================================================================
    // Configure AP IP
    // ================================================================

    WiFi.softAPConfig(
        ap_IP,
        ap_Gateway,
        ap_Subnet
    );


    // ================================================================
    // Start AP
    // ================================================================

    bool apStarted =
        WiFi.softAP(
            AP_SSID,
            AP_PASS
        );


    if (!apStarted) {

        Serial.println(
            "[AP ERROR] Failed to start Access Point!"
        );

        return;
    }


    // ================================================================
    // Serial information
    // ================================================================

    Serial.println();

    Serial.println(
        "=================================================="
    );

    Serial.println(
        "   [AP MODE] Tesseract Access Point Started"
    );

    Serial.println(
        "=================================================="
    );

    Serial.print(
        "SSID: "
    );

    Serial.println(
        AP_SSID
    );

    Serial.print(
        "Password: "
    );

    Serial.println(
        AP_PASS
    );

    Serial.print(
        "AP IP Address: "
    );

    Serial.println(
        WiFi.softAPIP()
    );

    Serial.println(
        "Connect phone to: Tesseract-Medicine"
    );

    Serial.println(
        "Open: http://192.168.4.1"
    );

    Serial.println(
        "=================================================="
    );


    // ================================================================
    // Start DNS captive portal
    // ================================================================

    dnsServer.stop();

    dnsServer.start(
        DNS_PORT,
        "*",
        WiFi.softAPIP()
    );


    // ================================================================
    // AP MODE ROUTES
    // ================================================================

    server.on(
        "/",
        handlePortalRoot
    );


    server.on(
        "/save",
        HTTP_POST,
        handleSaveWifi
    );


    // Android captive portal detection

    server.on(
        "/generate_204",
        handlePortalRoot
    );


    // iOS captive portal detection

    server.on(
        "/hotspot-detect.html",
        handlePortalRoot
    );


    // Apple

    server.on(
        "/canonical.html",
        handlePortalRoot
    );


    // Windows

    server.on(
        "/ncsi.txt",
        handlePortalRoot
    );


    // Any unknown URL

    server.onNotFound(
        handlePortalRoot
    );


    // ================================================================
    // START WEB SERVER
    // ================================================================

    server.begin();

    Serial.println(
        "[Web Server] Captive portal running on port 80"
    );
}


// =====================================================================
// CONNECT TO SAVED WIFI
// =====================================================================

bool connectToSavedWifi() {

    preferences.begin(
        "tesseract",
        true
    );


    savedSSID =
        preferences.getString(
            "ssid",
            ""
        );


    savedPassword =
        preferences.getString(
            "password",
            ""
        );


    preferences.end();


    // ---------------------------------------------------------------
    // No credentials
    // ---------------------------------------------------------------

    if (
        savedSSID.length() == 0
    ) {

        Serial.println();

        Serial.println(
            "[WiFi] No saved credentials."
        );

        return false;
    }


    // ---------------------------------------------------------------
    // Station mode
    // ---------------------------------------------------------------

    WiFi.mode(
        WIFI_STA
    );


    WiFi.begin(
        savedSSID.c_str(),
        savedPassword.c_str()
    );


    Serial.print(
        "[WiFi] Connecting to "
    );

    Serial.println(
        savedSSID
    );


    // ---------------------------------------------------------------
    // 15 second initial connection
    // ---------------------------------------------------------------

    unsigned long startTime =
        millis();


    while (
        WiFi.status() != WL_CONNECTED &&
        millis() - startTime < 15000
    ) {

        delay(500);

        Serial.print(".");
    }


    // ---------------------------------------------------------------
    // Connected
    // ---------------------------------------------------------------

    if (
        WiFi.status() ==
        WL_CONNECTED
    ) {

        Serial.println();

        Serial.println(
            "[WiFi] Connected successfully!"
        );


        Serial.print(
            "[WiFi] IP Address: "
        );


        Serial.println(
            WiFi.localIP()
        );


        return true;
    }


    // ---------------------------------------------------------------
    // Failed
    // ---------------------------------------------------------------

    Serial.println();

    Serial.println(
        "[WiFi] Failed to connect."
    );


    WiFi.disconnect(false);


    return false;
}


// =====================================================================
// SETUP
// =====================================================================

void setup() {

    Serial.begin(
        115200
    );


    delay(1000);


    Serial.println();

    Serial.println(
        "=================================================="
    );

    Serial.println(
        "     TESSERACT SMART MEDICINE MONITOR"
    );

    Serial.println(
        "=================================================="
    );


    // ===============================================================
    // DHT11
    // ===============================================================

    dht.begin();


    Serial.println(
        "[Sensors] DHT11 initialized on GPIO 4"
    );


    // ===============================================================
    // MEDICINE IR SENSOR
    // ===============================================================

#if ENABLE_MEDICINE_IR

    pinMode(
        MEDICINE_IR_PIN,
        INPUT
    );


    medicinePresent =
        (
            digitalRead(
                MEDICINE_IR_PIN
            )
            ==
            IR_ACTIVE_STATE
        );


    lastMedicinePresent =
        medicinePresent;


    Serial.println(
        "[Sensors] Medicine IR sensor active on GPIO 18"
    );


    if (
        medicinePresent
    ) {

        Serial.println(
            "[Medicine] PRESENT"
        );

    } else {

        Serial.println(
            "[Medicine] ABSENT"
        );
    }

#endif


    // ===============================================================
    // HX711
    // ===============================================================

#if ENABLE_WEIGHT_SENSOR

    scale.begin(
        HX711_DT,
        HX711_SCK
    );


    scale.set_scale(
        2280.f
    );


    scale.tare();


    if (
        scale.is_ready()
    ) {

        currentWeight =
            scale.get_units(5);
    }


    Serial.println(
        "[Sensors] HX711 active on GPIO 32/33"
    );

#else

    Serial.println(
        "[Sensors] HX711 disabled"
    );

#endif


    // ===============================================================
    // WIFI
    // ===============================================================

    if (
        !connectToSavedWifi()
    ) {

        startAccessPointMode();

    } else {

        // -----------------------------------------------------------
        // Online dashboard
        // -----------------------------------------------------------

        server.on(
            "/",
            handleOnlineRoot
        );


        server.on(
            "/data",
            handleData
        );


        server.on(
            "/reset-wifi",
            HTTP_POST,
            handleResetWifi
        );


        server.begin();


        Serial.println(
            "[Web Server] Local dashboard started."
        );


        // -----------------------------------------------------------
        // Initial DHT reading
        // -----------------------------------------------------------

        float initT =
            dht.readTemperature();


        float initH =
            dht.readHumidity();


        if (
            !isnan(initT) &&
            !isnan(initH)
        ) {

            temperature =
                initT;

            humidity =
                initH;
        }


        // -----------------------------------------------------------
        // Initial cloud telemetry
        // -----------------------------------------------------------

        pushCloudTelemetry(
            temperature,
            humidity,
            currentWeight,
            medicinePresent,
            100
        );
    }
}


// =====================================================================
// MAIN LOOP
// =====================================================================

void loop() {


    // ===============================================================
    // AP MODE
    // ===============================================================

    if (
        isAPMode
    ) {

        dnsServer.processNextRequest();

        server.handleClient();


        // -----------------------------------------------------------
        // IMPORTANT:
        // Sensors continue working even in AP mode
        // -----------------------------------------------------------

        unsigned long currentMillis =
            millis();


#if ENABLE_MEDICINE_IR

        bool currentMedicinePresent =
            (
                digitalRead(
                    MEDICINE_IR_PIN
                )
                ==
                IR_ACTIVE_STATE
            );


        if (
            currentMedicinePresent
            !=
            lastMedicinePresent
        ) {

            medicinePresent =
                currentMedicinePresent;


            if (
                medicinePresent
            ) {

                Serial.println(
                    "[Medicine IR] MEDICINE PRESENT"
                );

            } else {

                Serial.println(
                    "[Medicine IR] MEDICINE ABSENT"
                );
            }


            lastMedicinePresent =
                medicinePresent;
        }

#endif


        // -----------------------------------------------------------
        // DHT11
        // -----------------------------------------------------------

        if (
            currentMillis -
            lastSensorRead
            >=
            SENSOR_READ_INTERVAL_MS
        ) {

            float newT =
                dht.readTemperature();


            float newH =
                dht.readHumidity();


            if (
                !isnan(newT) &&
                !isnan(newH)
            ) {

                temperature =
                    newT;

                humidity =
                    newH;
            }


            lastSensorRead =
                currentMillis;
        }


        delay(5);

        return;
    }


    // ===============================================================
    // NORMAL ONLINE MODE
    // ===============================================================

    server.handleClient();


    // ===============================================================
    // WIFI LOSS DETECTION
    // ===============================================================

    if (
        WiFi.status() != WL_CONNECTED
    ) {


        // -----------------------------------------------------------
        // First detection
        // -----------------------------------------------------------

        if (
            !wifiReconnecting
        ) {

            wifiReconnecting =
                true;


            wifiDisconnectStart =
                millis();


            lastReconnectAttempt =
                0;


            Serial.println();

            Serial.println(
                "[WiFi] Connection lost."
            );


            Serial.println(
                "[WiFi] Starting 10-second reconnection timer..."
            );


            WiFi.reconnect();
        }


        // -----------------------------------------------------------
        // Reconnection attempts
        // -----------------------------------------------------------

        unsigned long disconnectedFor =
            millis() -
            wifiDisconnectStart;


        if (
            disconnectedFor <
            WIFI_RECONNECT_TIMEOUT_MS
        ) {


            if (
                millis() -
                lastReconnectAttempt
                >=
                WIFI_RECONNECT_INTERVAL_MS
            ) {

                lastReconnectAttempt =
                    millis();


                Serial.print(
                    "[WiFi] Reconnecting... "
                );


                Serial.print(
                    disconnectedFor /
                    1000
                );


                Serial.println(
                    " seconds"
                );


                WiFi.reconnect();
            }


            delay(10);

            return;
        }


        // -----------------------------------------------------------
        // 10 SECOND TIMEOUT
        // -----------------------------------------------------------

        Serial.println();

        Serial.println(
            "[WiFi] Reconnection timeout reached."
        );


        Serial.println(
            "[WiFi] Switching to AP mode..."
        );


        wifiReconnecting =
            false;


        startAccessPointMode();


        return;
    }


    // ===============================================================
    // WIFI RECOVERED
    // ===============================================================

    if (
        wifiReconnecting
    ) {

        wifiReconnecting =
            false;


        Serial.println();

        Serial.println(
            "[WiFi] Connection restored!"
        );


        Serial.print(
            "[WiFi] IP Address: "
        );


        Serial.println(
            WiFi.localIP()
        );
    }


    unsigned long currentMillis =
        millis();


    // ===============================================================
    // DHT11 READING
    // ===============================================================

    if (
        currentMillis -
        lastSensorRead
        >=
        SENSOR_READ_INTERVAL_MS
    ) {


        float newT =
            dht.readTemperature();


        float newH =
            dht.readHumidity();


        if (
            !isnan(newT) &&
            !isnan(newH)
        ) {

            temperature =
                newT;


            humidity =
                newH;


            Serial.print(
                "[DHT11] Temp: "
            );


            Serial.print(
                temperature,
                1
            );


            Serial.print(
                " °C | Humidity: "
            );


            Serial.print(
                humidity,
                1
            );


            Serial.println(
                " %"
            );

        } else {

            Serial.println(
                "[DHT11] Warning: Read failed"
            );
        }


        lastSensorRead =
            currentMillis;
    }


    // ===============================================================
    // MEDICINE IR SENSOR
    // ===============================================================

#if ENABLE_MEDICINE_IR

    bool currentMedicinePresent =
        (
            digitalRead(
                MEDICINE_IR_PIN
            )
            ==
            IR_ACTIVE_STATE
        );


    if (
        currentMedicinePresent
        !=
        lastMedicinePresent
    ) {


        medicinePresent =
            currentMedicinePresent;


        // -----------------------------------------------------------
        // MEDICINE INSERTED
        // -----------------------------------------------------------

        if (
            medicinePresent
        ) {

            Serial.println();

            Serial.println(
                "[Medicine IR] MEDICINE PRESENT"
            );


            sendApiAction(
                "MEDICINE_PRESENT",
                "{\"compartmentId\":\"A1\"}"
            );


        // -----------------------------------------------------------
        // MEDICINE REMOVED
        // -----------------------------------------------------------

        } else {

            Serial.println();

            Serial.println(
                "[Medicine IR] MEDICINE ABSENT"
            );


            sendApiAction(
                "MEDICINE_ABSENT",
                "{\"compartmentId\":\"A1\"}"
            );
        }


        lastMedicinePresent =
            medicinePresent;
    }

#endif


    // ===============================================================
    // OPTIONAL HX711
    // ===============================================================

#if ENABLE_WEIGHT_SENSOR

    if (
        scale.is_ready()
    ) {

        currentWeight =
            scale.get_units(3);
    }

#endif


    // ===============================================================
    // CLOUD TELEMETRY
    // ===============================================================

    if (
        currentMillis -
        lastCloudSync
        >=
        CLOUD_SYNC_INTERVAL_MS
    ) {


        if (
            temperature > 0.0 ||
            humidity > 0.0
        ) {

            Serial.println();

            Serial.println(
                "[Cloud] Pushing live telemetry..."
            );


            pushCloudTelemetry(
                temperature,
                humidity,
                currentWeight,
                medicinePresent,
                98
            );
        }


        lastCloudSync =
            currentMillis;
    }


    // ===============================================================
    // CPU YIELD
    // ===============================================================

    delay(10);
}