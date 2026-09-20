import React, { useState } from 'react';
import { useSimulation } from '../../context/SimulationContext';
import { Code2, Cpu, Info } from 'lucide-react';

export const EmbeddedCViewer: React.FC = () => {
  const { state, selectHardwareComponent } = useSimulation();

  const [activeCodeTab] = useState<'main'>('main');

  const mainCppCode = `/* ============================================================================
 * ESP32 Tesseract SYSTEM - FIRMWARE REFERENCE IMPLEMENTATION
 * Dual-Core FreeRTOS Embedded C/C++ Architecture
 * ============================================================================ */

#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <RTClib.h>
#include <DHT.h>
#include <HX711.h>
#include <WebServer.h>

// PIN DEFINITIONS & PROTOCOL MAPPINGS
#define DOOR_PIN        18    // Reed Switch Digital Input (INPUT_PULLUP)
#define DHT_PIN         4     // DHT22 Temperature & Humidity Sensor
#define DHT_TYPE        DHT22
#define LOAD_CELL_PIN   34    // HX711 ADC Differential Weight Sensor
#define BUZZER_PIN      21    // Active Buzzer PWM Output
#define LED_PIN         2     // Status Diagnostic LED
#define SDA_PIN         21    // I2C RTC Clock Data
#define SCL_PIN         22    // I2C RTC Clock Line

// GLOBAL OBJECT INSTANCES
DHT dht(DHT_PIN, DHT_TYPE);
RTC_DS3231 rtc;
HX711 scale;
WebServer server(80);

// GLOBAL SYSTEM VARIABLES
float temperature = 24.0;
float humidity = 48.0;
float chamberWeight = 52.4;
bool doorOpen = false;
bool medicinePresent = true;
uint8_t complianceRate = 91;

void setup() {
    Serial.begin(115200);
    Serial.println("[ESP32] Initializing Tesseract Firmware...");

    pinMode(DOOR_PIN, INPUT_PULLUP);
    pinMode(BUZZER_PIN, OUTPUT);
    pinMode(LED_PIN, OUTPUT);

    digitalWrite(LED_PIN, HIGH); // System Booting

    initializeSensors();
    initializeRTC();
    initializeWiFi();
    setupWebServerRoutes();

    Serial.println("[ESP32] System initialization complete. Launching FreeRTOS tasks.");
    digitalWrite(LED_PIN, LOW);
}

void loop() {
    readSensors();
    checkMedicationSchedule();
    detectDoseEvent();
    checkEnvironmentalLimits();
    updateStatusLED();
    server.handleClient();

    delay(1000); // 1-second continuous RTOS polling interval
}

/* ============================================================================
 * SENSOR ACQUISITION & LOGIC FUNCTIONS
 * ============================================================================ */

void readSensors() {
    temperature = dht.readTemperature();
    humidity = dht.readHumidity();
    doorOpen = (digitalRead(DOOR_PIN) == LOW);
    chamberWeight = scale.get_units(5);

    if (isnan(temperature) || isnan(humidity)) {
        Serial.println("[WARN] DHT22 Sensor Read Error!");
        triggerSensorFailureAlert();
    }
}

void checkMedicationSchedule() {
    DateTime now = rtc.now();
    // Compare RTC time with configured dosage schedule windows (08:00 AM, 02:00 PM, 08:00 PM)
    if (isDoseDue(now)) {
        triggerMedicationReminder();
    }
}

void detectDoseEvent() {
    if (doorOpen && (chamberWeight < 5.0)) { // Weight drop detected
        medicinePresent = false;
        recordDoseTaken();
        silenceReminder();
    }
}

void checkEnvironmentalLimits() {
    if (temperature > 25.0 || temperature < 15.0) {
        digitalWrite(LED_PIN, HIGH);
        digitalWrite(BUZZER_PIN, HIGH);
        logSystemEvent("TEMPERATURE_VIOLATION", "Temp out of storage limits!");
    }
}
`;

  const functionExplanations: Record<string, { purpose: string; hardware: string; pins: string }> = {
    'setup()': {
      purpose: 'Initializes GPIO pin modes, serial baud rate at 115200, DHT22 sensor, I2C RTC, and local HTTP Web Server.',
      hardware: 'ESP32 CPU & Serial Peripheral',
      pins: 'All Pins'
    },
    'readSensors()': {
      purpose: 'Polls ambient temperature, relative humidity, door reed switch state, and HX711 load cell weight value.',
      hardware: 'DHT22, Reed Switch, HX711 Load Cell',
      pins: 'GPIO 4, GPIO 18, GPIO 34'
    },
    'checkMedicationSchedule()': {
      purpose: 'Queries DS3231 I2C RTC time and evaluates active medication windows and 15-minute grace periods.',
      hardware: 'DS3231 Real-Time Clock',
      pins: 'I2C (SDA 21 / SCL 22)'
    },
    'detectDoseEvent()': {
      purpose: 'Evaluates whether container removal occurred during a valid schedule window. Updates dose status to TAKEN.',
      hardware: 'HX711 Load Cell & Reed Switch',
      pins: 'GPIO 18, GPIO 34'
    },
    'checkEnvironmentalLimits()': {
      purpose: 'Compares ambient temperature against project storage threshold (15°C - 25°C). Triggers buzzer if exceeded.',
      hardware: 'DHT22 & Buzzer Alarm',
      pins: 'GPIO 4, GPIO 21'
    }
  };

  const selectedExplanation = functionExplanations[state.currentFirmwareFunction || 'setup()'] || {
    purpose: 'Executes continuous sensor polling, medication window verification, environmental checks, and web server routes.',
    hardware: 'ESP32 Dual Core',
    pins: 'GPIO 18, GPIO 4, GPIO 34, GPIO 21'
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-[#0f172a] border border-[#1e293b] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center space-x-2">
            <Code2 className="w-5 h-5 text-cyan-400" />
            <span>REFERENCE ESP32 EMBEDDED C/C++ FIRMWARE IDE VIEWER</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Interactive code-to-hardware mapping. Selecting code lines highlights pins, sensors, and firmware tasks.
          </p>
        </div>

        <span className="bg-cyan-950 text-cyan-400 border border-cyan-800 px-3 py-1 rounded text-xs font-mono">
          C++ Arduino Core / FreeRTOS
        </span>
      </div>

      {/* CODE EXPLANATION SIDE-PANEL + IDE CONTAINER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT 8 COLS: CODE EDITOR */}
        <div className="lg:col-span-8 bg-[#090d16] border border-[#1e2d4a] rounded-xl overflow-hidden shadow-2xl flex flex-col font-mono text-xs">
          {/* Editor Header Bar */}
          <div className="bg-[#101726] px-4 py-2 border-b border-[#1e2d4a] flex justify-between items-center text-slate-400 text-[11px]">
            <div className="flex space-x-2">
              <button
                className={`px-2.5 py-1 rounded ${activeCodeTab === 'main' ? 'bg-[#1a263d] text-cyan-400 font-bold border border-cyan-800' : 'hover:text-slate-200'}`}
              >
                main.cpp
              </button>
            </div>
            <span>PlatformIO / Arduino Framework</span>
          </div>

          {/* Code Text Area */}
          <div className="p-4 overflow-x-auto text-slate-300 leading-relaxed max-h-[500px]">
            <pre>
              {mainCppCode.split('\n').map((line, idx) => {
                const lineNum = idx + 1;
                const isDoorLine = line.includes('DOOR_PIN');
                const isTempLine = line.includes('DHT');
                const isLoadLine = line.includes('LOAD_CELL');
                const isBuzzerLine = line.includes('BUZZER');

                return (
                  <div
                    key={idx}
                    onClick={() => {
                      if (isDoorLine) selectHardwareComponent('DOOR / REED SWITCH');
                      else if (isTempLine) selectHardwareComponent('TEMPERATURE SENSOR');
                      else if (isLoadLine) selectHardwareComponent('LOAD CELL');
                      else if (isBuzzerLine) selectHardwareComponent('BUZZER');
                    }}
                    className={`hover:bg-[#152036] cursor-pointer px-2 py-0.5 rounded flex space-x-3 transition-colors ${
                      isDoorLine && state.highlightedHardwareComponent === 'DOOR / REED SWITCH'
                        ? 'bg-cyan-950/80 text-cyan-300 border-l-2 border-cyan-400 font-bold'
                        : isTempLine && state.highlightedHardwareComponent === 'TEMPERATURE SENSOR'
                        ? 'bg-[#1a263d] text-blue-300 border-l-2 border-blue-400'
                        : ''
                    }`}
                  >
                    <span className="text-slate-600 select-none w-8 text-right shrink-0">{lineNum}</span>
                    <span className="truncate">{line}</span>
                  </div>
                );
              })}
            </pre>
          </div>
        </div>

        {/* RIGHT 4 COLS: FUNCTION EXPLANATION & HARDWARE MAPPING */}
        <div className="lg:col-span-4 space-y-4">
          {/* FUNCTION PURPOSE CARD */}
          <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-xl space-y-3">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center space-x-2 border-b border-[#1e293b] pb-2">
              <Info className="w-4 h-4 text-cyan-400" />
              <span>FIRMWARE FUNCTION EXPLANATION</span>
            </h4>

            <div className="bg-[#18233b] p-3 rounded-lg border border-[#27375a] space-y-2 text-xs">
              <div className="text-slate-400 font-mono text-[10px]">SELECTED FUNCTION:</div>
              <div className="font-bold text-amber-400 font-mono text-sm">
                {state.currentFirmwareFunction || 'setup()'}
              </div>

              <div className="text-slate-400 font-mono text-[10px] pt-1">FUNCTION PURPOSE:</div>
              <p className="text-slate-200 leading-relaxed">
                {selectedExplanation.purpose}
              </p>

              <div className="pt-2 border-t border-slate-700/60 flex justify-between font-mono text-[11px]">
                <span className="text-slate-400">Hardware Target:</span>
                <span className="text-cyan-300 font-semibold">{selectedExplanation.hardware}</span>
              </div>

              <div className="flex justify-between font-mono text-[11px]">
                <span className="text-slate-400">GPIO Pins:</span>
                <span className="text-amber-300 font-semibold">{selectedExplanation.pins}</span>
              </div>
            </div>
          </div>

          {/* CODE-TO-HARDWARE INTERACTION GUIDE */}
          <div className="bg-[#111a2e] border border-[#1e293b] rounded-xl p-4 shadow-xl text-xs space-y-2 text-slate-300">
            <h4 className="font-bold text-slate-200 flex items-center space-x-2 border-b border-[#1e293b] pb-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>CODE-TO-HARDWARE TRACE GUIDE</span>
            </h4>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Clicking code lines above highlights the physical components in the Digital Twin.
            </p>

            <ul className="space-y-1.5 font-mono text-[11px] pt-1">
              <li className="flex justify-between p-1.5 bg-[#18233b] rounded">
                <span className="text-cyan-400">digitalRead(DOOR_PIN)</span>
                <span className="text-slate-300">→ Reed Switch (GPIO 18)</span>
              </li>
              <li className="flex justify-between p-1.5 bg-[#18233b] rounded">
                <span className="text-cyan-400">dht.readTemperature()</span>
                <span className="text-slate-300">→ DHT22 Sensor (GPIO 4)</span>
              </li>
              <li className="flex justify-between p-1.5 bg-[#18233b] rounded">
                <span className="text-cyan-400">analogRead(LOAD_CELL)</span>
                <span className="text-slate-300">→ HX711 ADC (GPIO 34)</span>
              </li>
              <li className="flex justify-between p-1.5 bg-[#18233b] rounded">
                <span className="text-cyan-400">digitalWrite(BUZZER)</span>
                <span className="text-slate-300">→ Buzzer Alarm (GPIO 21)</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
