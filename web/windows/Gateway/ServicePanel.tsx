import React, { useState, useEffect, useCallback } from 'react';
import { gatewayApi } from '../../services/api';

interface DaemonState {
  platform: string;
  installed: boolean;
  enabled: boolean;
  active: boolean;
  unitFile: string;
  detail: string;
}

interface ServicePanelProps {
  status: any;
  healthCheckEnabled: boolean;
  healthStatus: { fail_count: number; last_ok: string } | null;
  gw: Record<string, any>;
  onCopy: (text: string) => void;
  toast: (type: 'success' | 'error', msg: string) => void;
  remote: boolean;
}

const PLATFORM_LABELS: Record<string, string> = {
  systemd: 'Linux (systemd)',
  launchd: 'macOS (launchd)',
  windows: 'Windows (sc)',
  unsupported: 'Unsupported',
};

const PLATFORM_ICONS: Record<string, string> = {
  systemd: 'deployed_code',
  launchd: 'laptop_mac',
  windows: 'desktop_windows',
  unsupported: 'block',
};

const ServicePanel: React.FC<ServicePanelProps> = ({ status, healthCheckEnabled, healthStatus, gw, onCopy, toast, remote }) => {
  const [daemon, setDaemon] = useState<DaemonState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<'install' | 'uninstall' | null>(null);

  const fetchDaemonStatus = useCallback(() => {
    setLoading(true);
    gatewayApi.daemonStatus()
      .then((data: any) => setDaemon(data))
      .catch(() => setDaemon(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchDaemonStatus(); }, [fetchDaemonStatus]);

  const handleInstall = useCallback(async () => {
    setActionLoading('install');
    try {
      const result: any = await gatewayApi.daemonInstall();
      setDaemon(result);
      toast('success', gw.daemonInstallOk || 'Service installed');
    } catch (err: any) {
      toast('error', err?.message || gw.daemonInstallFailed || 'Install failed');
    } finally {
      setActionLoading(null);
    }
  }, [gw, toast]);

  const handleUninstall = useCallback(async () => {
    setActionLoading('uninstall');
    try {
      const result: any = await gatewayApi.daemonUninstall();
      setDaemon(result);
      toast('success', gw.daemonUninstallOk || 'Service removed');
    } catch (err: any) {
      toast('error', err?.message || gw.daemonUninstallFailed || 'Uninstall failed');
    } finally {
      setActionLoading(null);
    }
  }, [gw, toast]);

  return (
    <div className="p-4 space-y-4 text-white/80 overflow-y-auto custom-scrollbar h-full">
      {/* Process Info */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-white/40 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[14px]">info</span>
          {gw.serviceProcessInfo || 'Process Info'}
        </h4>
        {status?.running ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              <p className="text-[9px] text-white/30 uppercase tracking-wider">{gw.status || 'Status'}</p>
              <p className="text-[12px] font-bold text-mac-green flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-mac-green animate-pulse" />
                {gw.running || 'Running'}
              </p>
            </div>
            <div className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              <p className="text-[9px] text-white/30 uppercase tracking-wider">{gw.runtimeMode || 'Mode'}</p>
              <p className="text-[12px] font-bold font-mono text-white/70">{status.runtime || '-'}</p>
            </div>
            <div className="px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.06] col-span-2">
              <p className="text-[9px] text-white/30 uppercase tracking-wider">{gw.serviceDetail || 'Detail'}</p>
              <p className="text-[11px] font-mono text-white/50 break-all">{status.detail || '-'}</p>
            </div>
          </div>
        ) : (
          <div className="px-3 py-4 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center">
            <span className="material-symbols-outlined text-[24px] text-white/15 mb-1">power_off</span>
            <p className="text-[11px] text-white/30">{gw.serviceNotRunning || 'Gateway is not running'}</p>
          </div>
        )}
      </div>

      {/* Daemon Service Status */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-white/40 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[14px]">settings_system_daydream</span>
          {gw.serviceTitle || 'System Service'}
        </h4>
        <p className="text-[10px] text-white/30 leading-relaxed">{gw.serviceDesc || 'Run gateway as an OS-level service for auto-start on boot'}</p>

        {remote ? (
          <div className="px-3 py-3 rounded-lg bg-white/[0.02] border border-white/[0.06] flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-white/20">cloud</span>
            <p className="text-[11px] text-white/40">{gw.daemonRemoteHint || 'Remote gateways are already running as services. Daemon management is only available for local gateways.'}</p>
          </div>
        ) : status?.runtime === 'systemd' || status?.runtime === 'docker' ? (
          <div className="px-3 py-3 rounded-lg bg-mac-green/5 border border-mac-green/20 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-mac-green">check_circle</span>
            <div>
              <p className="text-[11px] font-bold text-mac-green">{gw.daemonAlreadyManaged || 'Already managed by system service'}</p>
              <p className="text-[10px] text-white/40 mt-0.5">{status.runtime === 'systemd' ? 'systemd' : 'Docker'} — {status.detail || ''}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 px-3 py-3 rounded-lg bg-white/[0.02] border border-white/[0.06]">
            <span className="material-symbols-outlined text-[16px] text-white/20 animate-spin">progress_activity</span>
            <span className="text-[11px] text-white/30">{gw.loading || 'Loading...'}</span>
          </div>
        ) : daemon ? (
          <div className="space-y-2">
            {/* Platform & Status card */}
            <div className={`px-3 py-3 rounded-lg border flex items-center gap-3 ${
              daemon.installed
                ? 'bg-mac-green/5 border-mac-green/20'
                : 'bg-white/[0.02] border-white/[0.06]'
            }`}>
              <span className={`material-symbols-outlined text-[22px] ${daemon.installed ? 'text-mac-green' : 'text-white/20'}`}>
                {PLATFORM_ICONS[daemon.platform] || 'dns'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-white/70">
                  {PLATFORM_LABELS[daemon.platform] || daemon.platform}
                </p>
                <p className="text-[10px] text-white/40 mt-0.5">{daemon.detail}</p>
                {daemon.unitFile && (
                  <p className="text-[9px] font-mono text-white/20 mt-0.5 truncate">{daemon.unitFile}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {daemon.installed && (
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${daemon.active ? 'bg-mac-green/20 text-mac-green' : 'bg-mac-yellow/20 text-mac-yellow'}`}>
                    {daemon.active ? (gw.running || 'Running') : (gw.stopped || 'Stopped')}
                  </span>
                )}
                {daemon.enabled && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-primary/15 text-primary/80">
                    Auto-start
                  </span>
                )}
              </div>
            </div>

            {/* Action buttons */}
            {daemon.platform !== 'unsupported' && (
              <div className="flex items-center gap-2">
                {!daemon.installed ? (
                  <button
                    onClick={handleInstall}
                    disabled={!!actionLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mac-green/15 text-mac-green font-bold text-[10px] transition-all hover:bg-mac-green/25 disabled:opacity-40"
                  >
                    <span className={`material-symbols-outlined text-[14px] ${actionLoading === 'install' ? 'animate-spin' : ''}`}>
                      {actionLoading === 'install' ? 'progress_activity' : 'install_desktop'}
                    </span>
                    {gw.daemonInstall || 'Install Service'}
                  </button>
                ) : (
                  <button
                    onClick={handleUninstall}
                    disabled={!!actionLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-mac-red/15 text-mac-red font-bold text-[10px] transition-all hover:bg-mac-red/25 disabled:opacity-40"
                  >
                    <span className={`material-symbols-outlined text-[14px] ${actionLoading === 'uninstall' ? 'animate-spin' : ''}`}>
                      {actionLoading === 'uninstall' ? 'progress_activity' : 'delete_forever'}
                    </span>
                    {gw.daemonUninstall || 'Remove Service'}
                  </button>
                )}
                <button
                  onClick={fetchDaemonStatus}
                  disabled={loading}
                  className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-all disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[14px]">refresh</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="px-3 py-3 rounded-lg bg-white/[0.02] border border-white/[0.06] text-center">
            <p className="text-[11px] text-white/30">{gw.daemonStatusFailed || 'Failed to query daemon status'}</p>
            <button onClick={fetchDaemonStatus} className="mt-1 text-[10px] text-primary hover:underline">{gw.retry || 'Retry'}</button>
          </div>
        )}
      </div>

      {/* Watchdog Status */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-white/40 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[14px]">pets</span>
          {gw.serviceWatchdog || 'Watchdog'}
        </h4>
        <div className={`px-3 py-2.5 rounded-lg border flex items-center gap-2 ${
          healthCheckEnabled
            ? 'bg-mac-green/5 border-mac-green/20'
            : 'bg-white/[0.02] border-white/[0.06]'
        }`}>
          <span className={`material-symbols-outlined text-[18px] ${healthCheckEnabled ? 'text-mac-green' : 'text-white/20'}`}>
            {healthCheckEnabled ? 'shield' : 'shield_question'}
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-[11px] font-bold ${healthCheckEnabled ? 'text-mac-green' : 'text-white/40'}`}>
              {healthCheckEnabled
                ? (gw.serviceWatchdogActive || 'Active')
                : (gw.serviceWatchdogInactive || 'Inactive')}
            </p>
            {healthCheckEnabled && healthStatus && (
              <p className="text-[10px] text-white/30 mt-0.5">
                {healthStatus.fail_count > 0
                  ? `${gw.hbUnhealthy || 'Unhealthy'} (${healthStatus.fail_count} fails)`
                  : `${gw.hbHealthy || 'Healthy'} — ${healthStatus.last_ok ? new Date(healthStatus.last_ok).toLocaleTimeString() : '-'}`}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServicePanel;
