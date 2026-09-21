#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include "HX711.h"

// ================= WIFI CONFIG =================
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// ================= API CONFIG =================
// The Vercel URL you provided
const String API_URL = "https://tesseract-med-tracker.vercel.app/api/action";

// ================= PINS =================
#define DOOR_SENSOR_PIN 18 // Reed Switch
#define DHT_PIN 4          // DHT22 Data pin
#define DHT_TYPE DHT22
#define HX711_DT 32        // Load cell DT pin
#define HX711_SCK 33       // Load cell SCK pin

// ================= GLOBALS =================
DHT dht(DHT_PIN, DHT_TYPE);
HX711 scale;

bool lastDoorState = false; // false = closed, true = open
float lastWeight = 0.0;
float medicineThreshold = 10.0; // Assume < 10g means medicine was removed

void setup() {
  Serial.begin(115200);

  // 1. Initialize Sensors
  pinMode(DOOR_SENSOR_PIN, INPUT_PULLUP);
  dht.begin();
  scale.begin(HX711_DT, HX711_SCK);
  
  // You must run a calibration sketch first to find this value!
  scale.set_scale(2280.f); 
  scale.tare(); // Reset the scale to 0

  // 2. Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");
}

// Function to send POST request to the Vercel backend
void sendApiAction(String action, String payload) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(API_URL);
    http.addHeader("Content-Type", "application/json");

    // Create the JSON body e.g. {"action": "OPEN_DOOR", "payload": {}}
    String requestBody = "{\"action\":\"" + action + "\", \"payload\":" + payload + "}";
    int httpResponseCode = http.POST(requestBody);
    
    if (httpResponseCode > 0) {
      Serial.println("Sent action: " + action + " | Response: " + String(httpResponseCode));
    } else {
      Serial.println("Error sending POST request: " + String(httpResponseCode));
    }
    http.end();
  } else {
    Serial.println("WiFi Disconnected. Cannot send action.");
  }
}

void loop() {
  // ---------------------------------------------------------
  // 1. Check Door Sensor (Reed Switch)
  // Assuming LOW means magnet is near (door is closed)
  // ---------------------------------------------------------
  bool currentDoorState = digitalRead(DOOR_SENSOR_PIN) == HIGH;
  
  if (currentDoorState != lastDoorState) {
    if (currentDoorState == true) {
      sendApiAction("OPEN_DOOR", "{}");
    } else {
      sendApiAction("CLOSE_DOOR", "{}");
    }
    lastDoorState = currentDoorState;
  }

  // ---------------------------------------------------------
  // 2. Check Load Cell (Weight / Medicine Presence)
  // ---------------------------------------------------------
  if (scale.is_ready()) {
    float currentWeight = scale.get_units(5); // Average 5 readings
    
    // If weight drops significantly, medicine was removed
    if (lastWeight > medicineThreshold && currentWeight <= medicineThreshold) {
      // Hardcoded to Compartment A1 for this demo
      sendApiAction("REMOVE_MEDICINE", "{\"compartmentId\":\"A1\"}");
    }
    // If weight returns, medicine was restored
    else if (lastWeight <= medicineThreshold && currentWeight > medicineThreshold) {
      sendApiAction("RESTORE_MEDICINE", "{\"compartmentId\":\"A1\"}");
    }
    
    lastWeight = currentWeight;
  }

  // ---------------------------------------------------------
  // 3. Periodic Temperature Check (Optional)
  // ---------------------------------------------------------
  static unsigned long lastTempUpdate = 0;
  if (millis() - lastTempUpdate > 60000) { // Check every 60 seconds
    float t = dht.readTemperature();
    if (!isnan(t)) {
      // NOTE: The current backend action `ADJUST_TEMP` is a relative adjustment.
      // If you want to post absolute temperatures, you will need to add a `SET_TEMP` 
      // action case in `api/action.ts` on the Vercel backend.
      // Example: sendApiAction("SET_TEMP", "{\"value\":" + String(t) + "}");
      Serial.println("Current Temperature: " + String(t) + " C");
    }
    lastTempUpdate = millis();
  }

  delay(200); // Small delay to prevent spamming the loop
}
