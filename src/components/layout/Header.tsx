import React, { useState } from 'react';
import { useSimulation } from '../../context/SimulationContext';
import { SettingsDrawer } from './SettingsDrawer';
import { Settings } from 'lucide-react';

interface HeaderProps {
  activeTab?: string;
  onOpenSettings?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab = 'digitalTwin', onOpenSettings }) => {
  const { state } = useSimulation();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const pageInfo: Record<string, { title: string, subtitle: string }> = {
    dashboard: { title: 'Dashboard', subtitle: 'System overview and quick metrics' },
    'digital-twin': { title: 'Digital Twin', subtitle: 'Interactive circuit and system simulation' },
    medication: { title: 'Medication', subtitle: 'Medication adherence state machine' },
    analytics: { title: 'Analytics', subtitle: 'Environmental and adherence analytics' },
    events: { title: 'Events', subtitle: 'Real-time system events and alerts' },
    code: { title: 'Code', subtitle: 'Reference Embedded C/C++ firmware IDE' }
  };

  const info = pageInfo[activeTab] || { title: 'Digital Twin', subtitle: 'System Simulation' };

  // Format date/time
  const dateStr = state.currentSimulationTime.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = state.currentSimulationTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <>
      <header className="bg-[#080808] px-5 py-4 flex flex-wrap items-start justify-between text-xs sticky top-0 z-30 select-none border-b border-[#222222]">
        {/* Left: Page Title & Subtitle */}
        <div className="flex flex-col">
          <h1 className="font-semibold text-slate-100 text-xl tracking-wide">
            {info.title}
          </h1>
          <p className="text-slate-400 text-sm mt-0.5 font-sans">
            {info.subtitle}
          </p>
        </div>

        {/* Right: Technical Indicators & System Strip */}
        <div className="flex items-center space-x-6">
          {/* Status Strip */}
          {activeTab !== 'digital-twin' && (
            <div className="hidden lg:flex items-center space-x-6 mr-4">
              <div className="flex flex-col items-start">
                <div className="flex items-center space-x-1.5">
                  <span className={`w-2 h-2 rounded-full ${state.failures.powerFailed ? 'bg-rose-500' : 'bg-emerald-500'}`} />
                  <span className="text-slate-200 font-medium">ESP32</span>
                </div>
                <span className="text-[10px] text-emerald-500 ml-3.5 tracking-wider font-semibold">ONLINE</span>
              </div>

              <div className="flex flex-col items-start">
                <div className="flex items-center space-x-1.5">
                  <span className={`w-2 h-2 rounded-full ${state.wifiConnected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <span className="text-slate-200 font-medium">Wi-Fi</span>
                </div>
                <span className="text-[10px] text-emerald-500 ml-3.5 tracking-wider font-semibold">CONNECTED</span>
              </div>

              <div className="flex flex-col items-start">
                <div className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-slate-200 font-medium">RTC</span>
                </div>
                <span className="text-[10px] text-emerald-500 ml-3.5 tracking-wider font-semibold">SYNCED</span>
              </div>

              <div className="flex flex-col items-start">
                <div className="flex items-center space-x-1.5">
                  <span className={`w-2 h-2 rounded-full ${state.sensorsOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="text-slate-200 font-medium">Sensors</span>
                </div>
                <span className="text-[10px] text-emerald-500 ml-3.5 tracking-wider font-semibold">ACTIVE</span>
              </div>
            </div>
          )}

          {/* Simulation Clock */}
          <div className="flex flex-col items-end border-l border-[#222222] pl-6">
            <span className="text-slate-400 text-[11px] mb-0.5">{dateStr}</span>
            <span className="text-slate-100 font-mono text-base">{timeStr}</span>
          </div>

          {/* Settings Button */}
          <button
            onClick={() => {
              if (onOpenSettings) onOpenSettings();
              else setIsSettingsOpen(true);
            }}
            className="text-slate-400 hover:text-slate-200 transition-all ml-2"
            title="Open System Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <SettingsDrawer isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  );
};

