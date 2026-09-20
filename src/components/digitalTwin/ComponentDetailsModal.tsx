import React from 'react';
import { useSimulation } from '../../context/SimulationContext';
import { X, Info } from 'lucide-react';

export const ComponentDetailsModal: React.FC = () => {
  const { state, selectHardwareComponent, selectFirmwareFunction } = useSimulation();

  if (!state.highlightedHardwareComponent) return null;

  const compName = state.highlightedHardwareComponent;

  // Metadata mapping for selected components
  const componentDetailsMap: Record<
    string,
    {
      pin: string;
      interfaceType: string;
      purpose: string;
      firmwareFunction: string;
      currentVal: string;
      samplingRate: string;
      signalTrace: string;
    }
  > = {
    'DOOR / REED SWITCH': {
      pin: 'GPIO 18',
      interfaceType: 'Digital Input (INPUT_PULLUP)',
      purpose: 'Detects physical compartment door open/close state via magnetic switch.',
      firmwareFunction: 'digitalRead(DOOR_PIN); doorInterruptHandler();',
      currentVal: state.doorOpen ? 'OPEN (LOW)' : 'CLOSED (HIGH)',
      samplingRate: 'Hardware Interrupt / Edge Triggered',
      signalTrace: 'GPIO 18: LOW when door magnet separates, HIGH when sealed.'
    },
    'TEMPERATURE SENSOR': {
      pin: 'GPIO 4',
      interfaceType: 'Digital Single-Bus / OneWire',
      purpose: 'Measures medication chamber ambient temperature.',
      firmwareFunction: 'readSensors(); checkEnvironmentalLimits();',
      currentVal: `${state.temperature}°C`,
      samplingRate: '2000 ms Polling Interval',
      signalTrace: 'DHT22 protocol data packet transmitting temperature payload.'
    },
    'HUMIDITY SENSOR': {
      pin: 'GPIO 4',
      interfaceType: 'Digital Single-Bus / OneWire',
      purpose: 'Measures medication chamber relative humidity.',
      firmwareFunction: 'readSensors(); checkEnvironmentalLimits();',
      currentVal: `${state.humidity}% RH`,
      samplingRate: '2000 ms Polling Interval',
      signalTrace: 'DHT22 relative humidity 40-bit data frame.'
    },
    'LOAD CELL': {
      pin: 'GPIO 34 (ADC1_CH6)',
      interfaceType: 'Analog-to-Digital Converter (ADC / HX711)',
      purpose: 'Measures precise weight in grams to detect medicine removal/restoration.',
      firmwareFunction: 'analogRead(LOAD_CELL_PIN); detectDoseEvent();',
      currentVal: `${state.weight.toFixed(1)} g`,
      samplingRate: '500 ms ADC Polling',
      signalTrace: 'Differential analog voltage amplified by HX711 and digitized.'
    },
    ESP32: {
      pin: 'Central Controller (All Pins)',
      interfaceType: 'Dual Core Tensilica LX6 @ 240MHz',
      purpose: 'Executes edge firmware tasks, medication window state machine, local storage, and Web Server.',
      firmwareFunction: 'loop(); checkMedicationSchedule(); detectDoseEvent();',
      currentVal: 'CPU: RUNNING | FreeRTOS Scheduler Active',
      samplingRate: '1000 Hz Tick Rate',
      signalTrace: 'Central edge controller processing interrupts, GPIO signals, and HTTP requests.'
    },
    BUZZER: {
      pin: 'GPIO 21',
      interfaceType: 'Digital Output (PWM / Active Buzzer)',
      purpose: 'Audible indicator for medication schedule reminders and storage alerts.',
      firmwareFunction: 'digitalWrite(BUZZER_PIN, HIGH); triggerBuzzer();',
      currentVal: state.hardwareOutputs.buzzer,
      samplingRate: 'Event Driven',
      signalTrace: 'GPIO 21 output toggling 2.7kHz tone generator.'
    },
    LED: {
      pin: 'GPIO 2',
      interfaceType: 'Digital Output (Status LED)',
      purpose: 'Visual status indication (Normal Blue / Warning Flash).',
      firmwareFunction: 'digitalWrite(LED_PIN, HIGH); updateStatusLED();',
      currentVal: state.hardwareOutputs.led,
      samplingRate: 'Continuous Output',
      signalTrace: 'GPIO 2 High/Low logic level driving status diode.'
    },
    RTC: {
      pin: 'I2C (SDA GPIO 21, SCL GPIO 22)',
      interfaceType: 'I2C Master (0x68)',
      purpose: 'Provides precision real-time clock synchronization for dosage schedule calculation.',
      firmwareFunction: 'readRTC(); checkMedicationSchedule();',
      currentVal: state.currentSimulationTime.toLocaleTimeString(),
      samplingRate: '1000 ms Polling',
      signalTrace: 'I2C clock and data lines exchanging BCD time frames.'
    }
  };

  const details = componentDetailsMap[compName] || {
    pin: 'GPIO / Bus',
    interfaceType: 'Hardware Interface',
    purpose: 'Hardware component integrated in Tesseract box.',
    firmwareFunction: state.currentFirmwareFunction || 'loop()',
    currentVal: 'ACTIVE',
    samplingRate: 'Continuous',
    signalTrace: 'Signal trace active.'
  };

  return (
    <div className="bg-[#111c35] border border-cyan-500/50 rounded-xl p-4 shadow-2xl relative mb-4">
      <button
        onClick={() => selectHardwareComponent(null)}
        className="absolute top-3 right-3 text-slate-400 hover:text-slate-200 p-1 rounded-full hover:bg-slate-800"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center space-x-2 text-cyan-400 font-bold text-sm mb-2">
        <Info className="w-4 h-4" />
        <span>HARDWARE COMPONENT INSPECTOR — {compName}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="bg-[#182645] p-3 rounded-lg border border-[#2b3c66]">
          <div className="text-slate-400 font-mono text-[10px]">PIN ASSIGNMENT</div>
          <div className="font-bold text-cyan-300 text-sm mt-0.5">{details.pin}</div>
          <div className="text-slate-400 mt-2 font-mono text-[10px]">INTERFACE PROTOCOL</div>
          <div className="text-slate-200 font-medium">{details.interfaceType}</div>
        </div>

        <div className="bg-[#182645] p-3 rounded-lg border border-[#2b3c66]">
          <div className="text-slate-400 font-mono text-[10px]">CURRENT VALUE / STATE</div>
          <div className="font-bold text-emerald-400 text-sm mt-0.5">{details.currentVal}</div>
          <div className="text-slate-400 mt-2 font-mono text-[10px]">SAMPLING INTERVAL</div>
          <div className="text-slate-200 font-medium">{details.samplingRate}</div>
        </div>

        <div className="bg-[#182645] p-3 rounded-lg border border-[#2b3c66]">
          <div className="text-slate-400 font-mono text-[10px]">FIRMWARE FUNCTION MAPPING</div>
          <div className="font-bold text-amber-300 font-mono mt-0.5 truncate">
            {details.firmwareFunction}
          </div>
          <button
            onClick={() => selectFirmwareFunction(details.firmwareFunction.split(';')[0])}
            className="mt-2 text-[10px] bg-cyan-950 text-cyan-400 border border-cyan-800 px-2 py-0.5 rounded hover:bg-cyan-900 font-mono"
          >
            View in Code IDE →
          </button>
        </div>
      </div>

      <div className="mt-3 bg-[#0a1224] p-2.5 rounded border border-[#1b2b4d] text-xs text-slate-300 flex items-center justify-between">
        <div>
          <span className="font-semibold text-slate-200">Component Purpose: </span>
          <span>{details.purpose}</span>
        </div>
      </div>
    </div>
  );
};
