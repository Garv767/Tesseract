import React, { useState } from 'react';
import { useSimulation } from '../../context/SimulationContext';
import { Code2, Cpu, Info, FileCode } from 'lucide-react';

export const CodePage: React.FC = () => {
  const { state, selectHardwareComponent } = useSimulation();

  const [activeCodeTab, setActiveCodeTab] = useState<'main' | 'config' | 'web'>('main');

  const mainCppCode = `/* ============================================================================
 * ESP32 Tesseract SYSTEM - FIRMWARE IMPLEMENTATION
 * Dual-Core FreeRTOS Embedded C/C++ Architecture
 * ============================================================================ */

#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <RTClib.h>
#include <DHT.h>
#include <HX711.h>
#include <WebServer.h>

// PIN DEFINITIONS & HARDWARE MAPPINGS
#define DOOR_PIN        18    // Reed Switch Digital Input (INPUT_PULLUP)
#define DHT_PIN         4     // DHT22 Temperature & Humidity Sensor
#define DHT_TYPE        DHT22
#define LOAD_CELL_PIN   34    // HX711 ADC Differential Weight Sensor
#define BUZZER_PIN      21    // Active Buzzer PWM Output
#define LED_PIN         2     // Status Diagnostic LED
#define SDA_PIN         21    // I2C RTC Clock Data
#define SCL_PIN         22    // I2C RTC Clock Line

// GLOBAL SENSOR OBJECT INSTANCES
DHT dht(DHT_PIN, DHT_TYPE);
RTC_DS3231 rtc;
HX711 scale;
WebServer server(80);

// GLOBAL STATE VARIABLES
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

    Serial.println("[ESP32] Initialization complete. FreeRTOS scheduler active.");
    digitalWrite(LED_PIN, LOW);
}

void loop() {
    readSensors();
    checkMedicationSchedule();
    detectDoseEvent();
    checkEnvironmentalLimits();
    updateStatusLED();
    server.handleClient();

    delay(1000); // 1-second continuous RTOS polling tick
}

/* ============================================================================
 * HARDWARE INTERRUPT & SENSOR SAMPLING LOGIC
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
    // Compare RTC time with configured dosage schedule windows (08:00 AM, 08:00 PM)
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
    <div className="space-y-4 font-mono text-slate-200">
      {/* TOP HEADER */}
      <div className="bg-[#121212] border border-[#222222] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
        <div>
          <div className="flex items-center space-x-2 text-emerald-400 font-bold text-sm">
            <Code2 className="w-4 h-4" />
            <span>ESP32 EMBEDDED C/C++ FIRMWARE CODE VIEWER</span>
          </div>
          <p className="text-xs text-slate-400 mt-1 font-sans">
            Reference firmware implementation showing FreeRTOS task scheduling and hardware pin mapping.
          </p>
        </div>

        <div className="bg-[#080808] border border-[#222222] text-emerald-400 px-3 py-1.5 rounded-lg text-xs font-mono">
          PlatformIO / Arduino Framework C++
        </div>
      </div>

      {/* CODE EDITOR CONTAINER + HARDWARE TRACE SIDEBAR */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT 8 COLS: CODE EDITOR */}
        <div className="lg:col-span-8 bg-[#0a0a0a] border border-[#222222] rounded-xl overflow-hidden shadow-2xl flex flex-col font-mono text-xs">
          {/* Editor Header Bar */}
          <div className="bg-[#121212] px-4 py-2 border-b border-[#222222] flex justify-between items-center text-slate-400 text-[11px]">
            <div className="flex space-x-2">
              <button
                onClick={() => setActiveCodeTab('main')}
                className={`px-3 py-1 rounded-md flex items-center space-x-1.5 transition-colors ${
                  activeCodeTab === 'main' ? 'bg-[#222222] text-emerald-400 font-bold' : 'hover:text-slate-200'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>main.cpp</span>
              </button>
            </div>
            <span className="text-slate-500">Dual-Core Tensilica LX6 @ 240MHz</span>
          </div>

          {/* Code Text Area */}
          <div className="p-4 overflow-x-auto text-slate-300 leading-relaxed max-h-[540px]">
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
                    className={`hover:bg-[#181818] cursor-pointer px-2 py-0.5 rounded flex space-x-3 transition-colors ${
                      isDoorLine && state.highlightedHardwareComponent === 'DOOR / REED SWITCH'
                        ? 'bg-emerald-950/80 text-emerald-300 border-l-2 border-emerald-400 font-bold'
                        : isTempLine && state.highlightedHardwareComponent === 'TEMPERATURE SENSOR'
                        ? 'bg-[#181818] text-amber-300 border-l-2 border-amber-400'
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

        {/* RIGHT 4 COLS: HARDWARE TRACE & FUNCTION INSPECTOR */}
        <div className="lg:col-span-4 space-y-4">
          {/* FUNCTION PURPOSE CARD */}
          <div className="bg-[#121212] border border-[#222222] rounded-xl p-4 shadow-lg space-y-3 text-xs">
            <div className="flex items-center space-x-2 font-bold text-slate-300 uppercase tracking-wider border-b border-[#222222] pb-2">
              <Info className="w-4 h-4 text-emerald-400" />
              <span>FIRMWARE FUNCTION EXPLANATION</span>
            </div>

            <div className="bg-[#0a0a0a] p-3 rounded-lg border border-[#222222] space-y-2">
              <div className="text-slate-500 font-mono text-[10px]">SELECTED FUNCTION:</div>
              <div className="font-bold text-amber-400 font-mono text-sm">
                {state.currentFirmwareFunction || 'setup()'}
              </div>

              <div className="text-slate-500 font-mono text-[10px] pt-1">FUNCTION PURPOSE:</div>
              <p className="text-slate-300 font-sans leading-relaxed">
                {selectedExplanation.purpose}
              </p>

              <div className="pt-2 border-t border-[#1e1e1e] flex justify-between font-mono text-[11px]">
                <span className="text-slate-500">Hardware Target:</span>
                <span className="text-emerald-400 font-semibold">{selectedExplanation.hardware}</span>
              </div>

              <div className="flex justify-between font-mono text-[11px]">
                <span className="text-slate-500">GPIO Pins:</span>
                <span className="text-amber-400 font-semibold">{selectedExplanation.pins}</span>
              </div>
            </div>
          </div>

          {/* CODE-TO-HARDWARE INTERACTION GUIDE */}
          <div className="bg-[#121212] border border-[#222222] rounded-xl p-4 shadow-lg space-y-3 text-xs">
            <div className="flex items-center space-x-2 font-bold text-slate-300 uppercase tracking-wider border-b border-[#222222] pb-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <span>PIN MAPPING TRACE GUIDE</span>
            </div>

            <p className="text-[11px] text-slate-400 font-sans">
              Click any code line in the editor to inspect corresponding GPIO hardware signals.
            </p>

            <ul className="space-y-1.5 font-mono text-[11px]">
              <li className="flex justify-between p-2 bg-[#0a0a0a] rounded border border-[#1e1e1e]">
                <span className="text-emerald-400 font-bold">digitalRead(DOOR_PIN)</span>
                <span className="text-slate-400">GPIO 18</span>
              </li>
              <li className="flex justify-between p-2 bg-[#0a0a0a] rounded border border-[#1e1e1e]">
                <span className="text-emerald-400 font-bold">dht.readTemperature()</span>
                <span className="text-slate-400">GPIO 4</span>
              </li>
              <li className="flex justify-between p-2 bg-[#0a0a0a] rounded border border-[#1e1e1e]">
                <span className="text-emerald-400 font-bold">scale.get_units(5)</span>
                <span className="text-slate-400">GPIO 34</span>
              </li>
              <li className="flex justify-between p-2 bg-[#0a0a0a] rounded border border-[#1e1e1e]">
                <span className="text-emerald-400 font-bold">digitalWrite(BUZZER)</span>
                <span className="text-slate-400">GPIO 21</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
