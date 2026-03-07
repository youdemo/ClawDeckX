import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Language } from '../../types';
import { getTranslation } from '../../locales';
import { selfUpdateApi, hostInfoApi, serviceApi, gatewayApi } from '../../services/api';
import type { SelfUpdateInfo, UpdateCheckResult, UpdateHistoryEntry } from '../../services/api';
import { useToast } from '../../components/Toast';
import { useConfirm } from '../../components/ConfirmDialog';
import CustomSelect from '../../components/CustomSelect';
import TranslateModelPicker from '../../components/TranslateModelPicker';
import { SmartLink } from '../../components/SmartLink';
import { useOpenClawUpdate } from '../../hooks/useOpenClawUpdate';

declare const __APP_VERSION__: string;
declare const __BUILD_NUMBER__: string;

export interface UpdateTabProps {
  s: any;
  language: Language;
  inputCls: string;
  rowCls: string;
}

const UpdateTab: React.FC<UpdateTabProps> = ({ s, language, inputCls, rowCls }) => {
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const sk = useMemo(() => (getTranslation(language) as any).sk || {}, [language]);

  // ── OpenClaw 更新 ──
  const [ocUpdateChecking, setOcUpdateChecking] = useState(false);
  const [ocUpdateInfo, setOcUpdateInfo] = useState<{ available: boolean; currentVersion?: string; latestVersion?: string; releaseNotes?: string; publishedAt?: string; error?: string } | null>(null);
  const {
    running: ocUpdating,
    logs: ocUpdateLogs,
    step: ocUpdateStep,
    progress: ocUpdateProgress,
    run: runOcUpdate,
  } = useOpenClawUpdate();
  const ocUpdateLogRef = useRef<HTMLDivElement>(null);

  // ── 自更新 ──
  const [selfUpdateChecking, setSelfUpdateChecking] = useState(false);
  const [selfUpdateInfo, setSelfUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [selfUpdating, setSelfUpdating] = useState(false);
  const [selfUpdateProgress, setSelfUpdateProgress] = useState<{ stage: string; percent: number; error?: string; done?: boolean } | null>(null);
  const [selfUpdateVersion, setSelfUpdateVersion] = useState<SelfUpdateInfo | null>(null);
  const [updateChannel, setUpdateChannel] = useState<'stable' | 'beta'>('stable');
  const [updateHistory, setUpdateHistory] = useState<UpdateHistoryEntry[]>([]);
  const lastAutoCheckRef = useRef<number>(0);
  const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);
  const UPDATE_CHECK_CACHE_MS = 60 * 60 * 1000; // 1 hour cache
  const [translatedNotes, setTranslatedNotes] = useState<string | null>(null);
  const [notesTranslating, setNotesTranslating] = useState(false);
  const [showTranslated, setShowTranslated] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [ocTranslatedNotes, setOcTranslatedNotes] = useState<string | null>(null);
  const [ocNotesTranslating, setOcNotesTranslating] = useState(false);
  const [ocShowTranslated, setOcShowTranslated] = useState(false);
  const [ocNotesExpanded, setOcNotesExpanded] = useState(false);

  // ── 服务状态 ──
  const [serviceStatus, setServiceStatus] = useState<{ openclaw_installed: boolean; clawdeckx_installed: boolean } | null>(null);
  const [serviceLoading, setServiceLoading] = useState(false);

  // Markdown-like rendering for release notes
  const renderMarkdown = useCallback((text: string) => {
    return text
      .replace(/^### (.+)$/gm, '<h4 class="font-bold text-slate-700 dark:text-white/70 mt-2 mb-1">$1</h4>')
      .replace(/^## (.+)$/gm, '<h3 class="font-bold text-slate-700 dark:text-white/70 text-[12px] mt-3 mb-1">$1</h3>')
      .replace(/^- (.+)$/gm, '<li class="ms-3 list-disc">$1</li>')
      .replace(/^\* (.+)$/gm, '<li class="ms-3 list-disc">$1</li>')
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-[10px] font-mono">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '<br/>')
      .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline break-all">$1</a>');
  }, []);

  // Self-update handlers
  const handleSelfUpdateCheck = useCallback(async () => {
    setSelfUpdateChecking(true);
    setSelfUpdateInfo(null);
    setSelfUpdateProgress(null);
    setTranslatedNotes(null);
    setShowTranslated(false);
    setNotesExpanded(false);
    try {
      const res = updateChannel === 'beta' ? await selfUpdateApi.checkChannel('beta') : await selfUpdateApi.check();
      setSelfUpdateInfo(res);
    } catch { setSelfUpdateInfo({ available: false, currentVersion: '', latestVersion: '', error: s.networkError }); }
    setSelfUpdateChecking(false);
  }, [updateChannel, s]);

  const handleSelfUpdateApply = useCallback(async () => {
    if (!selfUpdateInfo?.downloadUrl) return;
    setSelfUpdating(true);
    setSelfUpdateProgress({ stage: 'connecting', percent: 0 });
    try {
      const token = localStorage.getItem('token');
      const resp = await fetch('/api/v1/self-update/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ downloadUrl: selfUpdateInfo.downloadUrl }),
      });
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let buf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const p = JSON.parse(line.slice(6));
                setSelfUpdateProgress(p);
                if (p.done) {
                  toast('success', s.selfUpdateDone);
                  setTimeout(() => window.location.reload(), 3000);
                }
                if (p.error) {
                  toast('error', p.error);
                }
              } catch { /* ignore parse errors */ }
            }
          }
        }
      }
    } catch (err: any) {
      setSelfUpdateProgress({ stage: 'error', percent: 0, error: err?.message || s.unknownError });
      toast('error', s.selfUpdateFailed);
    }
    setSelfUpdating(false);
  }, [selfUpdateInfo, s, toast]);

  // Release notes translation — cached in SQLite via backend
  const handleTranslateNotes = useCallback(async (text: string, product?: string, ver?: string) => {
    if (!text || language === 'en') return;
    setNotesTranslating(true);
    try {
      const res = await selfUpdateApi.translateNotes(text, language, product || 'clawdeckx', ver || '0');
      setTranslatedNotes(res.translated);
      setShowTranslated(true);
    } catch {
      toast('error', s.translateFailed || 'Translation failed');
    }
    setNotesTranslating(false);
  }, [language, s, toast]);

  // OpenClaw update handlers
  const handleOcUpdateCheck = useCallback(async () => {
    setOcUpdateChecking(true);
    setOcUpdateInfo(null);
    setOcTranslatedNotes(null);
    setOcShowTranslated(false);
    setOcNotesExpanded(false);
    try {
      const res = await hostInfoApi.checkUpdate();
      setOcUpdateInfo(res);
      setOcUpdateChecking(false);
      // Auto-translate release notes for non-English users (cached in SQLite via backend)
      if (res.releaseNotes && language !== 'en') {
        const ver = res.latestVersion || res.currentVersion || '0';
        setOcNotesTranslating(true);
        try {
          const tr = await selfUpdateApi.translateNotes(res.releaseNotes, language, 'openclaw', ver);
          setOcTranslatedNotes(tr.translated);
          setOcShowTranslated(true);
        } catch { /* translation failed, show original */ }
        setOcNotesTranslating(false);
      }
    } catch {
      setOcUpdateInfo({ available: false, error: s.networkError });
      setOcUpdateChecking(false);
    }
  }, [language, s]);

  const handleOcUpdateRun = useCallback(async () => {
    const ok = await confirm({
      title: s.openclawUpdateRun || 'Update OpenClaw',
      message: `${s.openclawUpdateConfirm || 'Update OpenClaw from'} v${ocUpdateInfo?.currentVersion || '?'} → v${ocUpdateInfo?.latestVersion || '?'}`,
      confirmText: s.openclawUpdateRun || 'Update',
      danger: false,
    });
    if (!ok) return;
    try {
      await runOcUpdate();
      toast('success', s.openclawUpdateOk);
      await new Promise(r => setTimeout(r, 1500));
      const res = await hostInfoApi.checkUpdate();
      setOcUpdateInfo({ ...res, available: false });
    } catch {
      toast('error', s.openclawUpdateFailed);
    }
  }, [runOcUpdate, s, toast, confirm, ocUpdateInfo]);

  // OpenClaw 升级日志自动滚动
  useEffect(() => {
    if (ocUpdateLogRef.current) {
      ocUpdateLogRef.current.scrollTop = ocUpdateLogRef.current.scrollHeight;
    }
  }, [ocUpdateLogs]);

  // 服务管理
  const loadServiceStatus = useCallback(async () => {
    try {
      const data = await serviceApi.status();
      setServiceStatus(data);
    } catch (err) {
      console.error('Failed to load service status:', err);
    }
  }, []);

  const handleServiceInstall = useCallback(async (service: 'openclaw' | 'clawdeckx') => {
    setServiceLoading(true);
    try {
      if (service === 'openclaw') {
        const res = await gatewayApi.daemonInstall();
        // Immediately reflect the installed state from the response
        setServiceStatus(prev => prev ? { ...prev, openclaw_installed: res.installed } : { openclaw_installed: res.installed, clawdeckx_installed: false });
        toast('success', s.serviceInstalled || 'OpenClaw service installed');
      } else {
        await serviceApi.installClawDeckX();
        toast('success', s.serviceInstalled || 'ClawDeckX service installed');
      }
      await loadServiceStatus();
    } catch (err: any) {
      toast('error', err.message || 'Installation failed');
    } finally {
      setServiceLoading(false);
    }
  }, [s, toast, loadServiceStatus]);

  const handleServiceUninstall = useCallback(async (service: 'openclaw' | 'clawdeckx') => {
    setServiceLoading(true);
    try {
      if (service === 'openclaw') {
        const res = await gatewayApi.daemonUninstall();
        // Immediately reflect the uninstalled state from the response
        setServiceStatus(prev => prev ? { ...prev, openclaw_installed: res.installed } : { openclaw_installed: res.installed, clawdeckx_installed: false });
        toast('success', s.serviceUninstalled || 'OpenClaw service uninstalled');
      } else {
        await serviceApi.uninstallClawDeckX();
        toast('success', s.serviceUninstalled || 'ClawDeckX service uninstalled');
      }
      await loadServiceStatus();
    } catch (err: any) {
      toast('error', err.message || 'Uninstallation failed');
    } finally {
      setServiceLoading(false);
    }
  }, [s, toast, loadServiceStatus]);

  // 初始化数据加载
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      selfUpdateApi.info().then(d => setSelfUpdateVersion(d)).catch(() => { });
      selfUpdateApi.history().then(setUpdateHistory).catch(() => { });
      if (!ocUpdateInfo) hostInfoApi.checkUpdate().then(res => setOcUpdateInfo(res)).catch(() => { });
      loadServiceStatus();
      // Auto-check with 1-hour cache — skip if checked recently
      const now = Date.now();
      if (now - lastAutoCheckRef.current > UPDATE_CHECK_CACHE_MS) {
        lastAutoCheckRef.current = now;
        setLastCheckTime(now);
        handleSelfUpdateCheck();
        handleOcUpdateCheck();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-slate-800 dark:text-white">{s.system || 'Software Update'}</h2>
        <p className="text-[12px] text-slate-400 dark:text-white/40 mt-1">{s.selfUpdateDesc}</p>
      </div>

      {/* 更新通道 + 一键检查 */}
      <div className={rowCls}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-cyan-500">tune</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.updateChannel || 'Update Channel'}</h4>
            </div>
            <CustomSelect value={updateChannel} onChange={v => { setUpdateChannel(v as 'stable' | 'beta'); setSelfUpdateInfo(null); }}
              options={[{ value: 'stable', label: 'Stable' }, { value: 'beta', label: 'Beta' }]} className="w-28" />
          </div>
          <p className="text-[11px] text-slate-400 dark:text-white/30 mb-3">
            {updateChannel === 'beta' ? (s.updateChannelBetaDesc || 'Beta channel includes pre-release versions with the latest features but may be less stable.') : (s.updateChannelStableDesc || 'Stable channel provides tested releases recommended for production use.')}
          </p>
          {/* 一键全部检查 */}
          {lastCheckTime && !selfUpdateChecking && !ocUpdateChecking && (
            <p className="text-[11px] text-slate-400 dark:text-white/30 mb-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px]">schedule</span>
              {s.lastChecked || 'Last checked'}: {new Date(lastCheckTime).toLocaleString()}
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={() => { const now = Date.now(); lastAutoCheckRef.current = now; setLastCheckTime(now); handleSelfUpdateCheck(); handleOcUpdateCheck(); }}
              disabled={selfUpdateChecking || ocUpdateChecking}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-cyan-500 text-white text-[12px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
              <span className={`material-symbols-outlined text-[16px] ${selfUpdateChecking || ocUpdateChecking ? 'animate-spin' : ''}`}>
                {selfUpdateChecking || ocUpdateChecking ? 'progress_activity' : 'refresh'}
              </span>
              {s.checkUpdate || 'Check for Updates'}
            </button>
            {selfUpdateInfo?.available && ocUpdateInfo?.available && (
              <button onClick={async () => { await handleSelfUpdateApply(); handleOcUpdateRun(); }}
                disabled={selfUpdating || ocUpdating}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-gradient-to-r from-primary to-emerald-500 text-white text-[12px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
                <span className="material-symbols-outlined text-[16px]">system_update_alt</span>
                {s.updateAll || 'Update All'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 翻译模型选择 */}
      {language !== 'en' && (
        <div className={rowCls}>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[16px] text-blue-500/60">translate</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{sk.translateModel || 'Translation Model'}</h4>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-white/40 mb-3">
              {language === 'zh'
                ? '选择用于翻译技能描述和更新日志的模型。默认自动选择最便宜的可用模型，未配置模型时使用免费 API。'
                : 'Choose the model for translating skill descriptions and release notes. Defaults to the cheapest available; falls back to free API if none configured.'}
            </p>
            <TranslateModelPicker sk={sk} />
          </div>
        </div>
      )}

      {/* ── 🦀 ClawDeckX 更新卡片 ── */}
      <div className={rowCls}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[18px]">🦀</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">ClawDeckX</h4>
              <SmartLink href="https://github.com/ClawDeckX/ClawDeckX" className="flex items-center text-slate-400 dark:text-white/30 hover:text-primary transition-colors" title="GitHub">
                <svg className="w-[14px] h-[14px]" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              </SmartLink>
            </div>
            <div className="flex items-center gap-2">
              {serviceStatus && (
                <button
                  onClick={() => serviceStatus.clawdeckx_installed ? handleServiceUninstall('clawdeckx') : handleServiceInstall('clawdeckx')}
                  disabled={serviceLoading}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors flex items-center gap-1 ${
                    serviceStatus.clawdeckx_installed
                      ? 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10'
                      : 'bg-primary/10 text-primary hover:bg-primary/20'
                  } disabled:opacity-50`}
                >
                  <span className="material-symbols-outlined text-[12px]">{serviceStatus.clawdeckx_installed ? 'check_circle' : 'add_circle'}</span>
                  {serviceStatus.clawdeckx_installed ? (s.serviceInstalled || 'Service') : (s.installService || 'Install Service')}
                </button>
              )}
              <span className="font-mono text-[12px] font-bold text-slate-600 dark:text-white/60">
                v{__APP_VERSION__} <span className="font-normal text-slate-400 dark:text-white/30">(build {__BUILD_NUMBER__})</span>
              </span>
            </div>
          </div>

          {/* 状态 */}
          {!selfUpdateInfo && !selfUpdateChecking && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-[14px]">info</span>
              {s.selfUpdateDesc}
            </div>
          )}
          {selfUpdateChecking && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-white/50">
              <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
              {s.selfUpdateChecking || 'Checking...'}
            </div>
          )}
          {selfUpdateInfo && !selfUpdateInfo.available && !selfUpdateInfo.error && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="material-symbols-outlined text-[14px] text-mac-green">check_circle</span>
              <span className="text-mac-green font-medium">{s.selfUpdateCurrent}</span>
            </div>
          )}
          {selfUpdateInfo?.error && !selfUpdateInfo.available && (() => {
            const err = selfUpdateInfo.error;
            let msg = err;
            let icon = 'error';
            let color = 'text-red-500';
            if (err.startsWith('GITHUB_SERVER_ERROR:')) {
              msg = s.updateGithubServerError || 'GitHub server is temporarily unavailable, please try again later';
              icon = 'cloud_off';
              color = 'text-amber-500';
            } else if (err === 'GITHUB_RATE_LIMITED') {
              msg = s.updateGithubRateLimited || 'GitHub API rate limit reached, please try again later';
              icon = 'schedule';
              color = 'text-amber-500';
            } else if (err.startsWith('GITHUB_API_ERROR:')) {
              msg = s.updateGithubApiError || 'Unable to connect to GitHub, please check your network';
              icon = 'wifi_off';
              color = 'text-amber-500';
            }
            return (
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className={`material-symbols-outlined text-[14px] ${color}`}>{icon}</span>
                <span className={color}>{msg}</span>
              </div>
            );
          })()}

          {/* Release Notes — 无论是否有更新，只要有 releaseNotes 就显示 */}
          {selfUpdateInfo && !selfUpdateInfo.available && selfUpdateInfo.releaseNotes && (() => {
            const notesText = (showTranslated && translatedNotes) ? translatedNotes : selfUpdateInfo.releaseNotes!;
            const isLong = notesText.length > 600;
            return (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-white/40">
                    <span className="material-symbols-outlined text-[14px]">description</span>
                    {s.selfUpdateReleaseNotes} <span className="font-normal ms-1 text-[10px] text-slate-400 dark:text-white/25">v{selfUpdateInfo.latestVersion || selfUpdateInfo.currentVersion}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {language !== 'en' && (
                      translatedNotes ? (
                        <button onClick={() => setShowTranslated(v => !v)}
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 transition-colors">
                          <span className="material-symbols-outlined text-[12px]">translate</span>
                          {showTranslated ? (s.showOriginal || 'Original') : (s.showTranslation || 'Translated')}
                        </button>
                      ) : (
                        <button onClick={() => handleTranslateNotes(selfUpdateInfo.releaseNotes!, 'clawdeckx', selfUpdateInfo.latestVersion || selfUpdateInfo.currentVersion)} disabled={notesTranslating}
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 disabled:opacity-40 transition-colors">
                          <span className={`material-symbols-outlined text-[12px] ${notesTranslating ? 'animate-spin' : ''}`}>
                            {notesTranslating ? 'progress_activity' : 'translate'}
                          </span>
                          {notesTranslating ? (s.translating || 'Translating...') : (s.translateNotes || 'Translate')}
                        </button>
                      )
                    )}
                    {isLong && (
                      <button onClick={() => setNotesExpanded(v => !v)}
                        className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-400 dark:text-white/30 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                        <span className="material-symbols-outlined text-[12px]">{notesExpanded ? 'expand_less' : 'expand_more'}</span>
                        {notesExpanded ? (s.collapse || 'Collapse') : (s.expand || 'Expand')}
                      </button>
                    )}
                  </div>
                </div>
                {selfUpdateInfo.publishedAt && (
                  <div className="text-[10px] text-slate-400 dark:text-white/30 px-1">
                    {s.updatePublishedAt || 'Published'}: {(() => {
                      const diff = Date.now() - new Date(selfUpdateInfo.publishedAt!).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 60) return `${mins}m ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24) return `${hrs}h ago`;
                      return `${Math.floor(hrs / 24)}d ago`;
                    })()}
                  </div>
                )}
                <div className={`relative px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-[11px] text-slate-600 dark:text-white/50 leading-relaxed overflow-hidden transition-all duration-300 ${
                  isLong && !notesExpanded ? 'max-h-36' : 'max-h-[600px]'
                } overflow-y-auto`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(notesText) }} />
                {isLong && !notesExpanded && (
                  <div className="relative -mt-10 h-10 bg-gradient-to-t from-slate-50 dark:from-[#1c1c1e] to-transparent pointer-events-none rounded-b-lg" />
                )}
              </div>
            );
          })()}

          {/* 新版本可用 */}
          {selfUpdateInfo?.available && (
            <div className="mt-2 space-y-3">
              <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-primary/5 dark:bg-primary/10 border border-primary/20">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-primary">new_releases</span>
                  <span className="text-[11px] font-bold text-primary">{s.selfUpdateAvailable}</span>
                </div>
                <span className="text-[11px] font-mono font-bold text-primary">v{selfUpdateInfo.currentVersion} → v{selfUpdateInfo.latestVersion}</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-slate-400 dark:text-white/30 px-1">
                {selfUpdateInfo.publishedAt && (
                  <span>{s.updatePublishedAt || 'Published'}: {(() => {
                    const d = new Date(selfUpdateInfo.publishedAt);
                    const diff = Date.now() - d.getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    const days = Math.floor(hrs / 24);
                    return `${days}d ago`;
                  })()}</span>
                )}
                {(selfUpdateInfo.assetSize ?? 0) > 0 && <span>{s.selfUpdateSize}: {((selfUpdateInfo.assetSize ?? 0) / 1024 / 1024).toFixed(1)} MB</span>}
                {selfUpdateInfo.channel && <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-medium">{selfUpdateInfo.channel}</span>}
              </div>
              {/* Release Notes with translation + collapse */}
              {selfUpdateInfo.releaseNotes && (() => {
                const notesText = (showTranslated && translatedNotes) ? translatedNotes : selfUpdateInfo.releaseNotes!;
                const isLong = notesText.length > 600;
                return (
                  <div className="space-y-2">
                    {/* Header: title + translate/toggle buttons */}
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-white/40">
                        <span className="material-symbols-outlined text-[14px]">description</span>
                        {s.selfUpdateReleaseNotes}
                      </div>
                      <div className="flex items-center gap-1">
                        {/* Translate / Toggle button (non-English only) */}
                        {language !== 'en' && (
                          translatedNotes ? (
                            <button onClick={() => setShowTranslated(v => !v)}
                              className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 transition-colors">
                              <span className="material-symbols-outlined text-[12px]">translate</span>
                              {showTranslated ? (s.showOriginal || 'Original') : (s.showTranslation || 'Translated')}
                            </button>
                          ) : (
                            <button onClick={() => handleTranslateNotes(selfUpdateInfo.releaseNotes!, 'clawdeckx', selfUpdateInfo.latestVersion || selfUpdateInfo.currentVersion)} disabled={notesTranslating}
                              className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 disabled:opacity-40 transition-colors">
                              <span className={`material-symbols-outlined text-[12px] ${notesTranslating ? 'animate-spin' : ''}`}>
                                {notesTranslating ? 'progress_activity' : 'translate'}
                              </span>
                              {notesTranslating ? (s.translating || 'Translating...') : (s.translateNotes || 'Translate')}
                            </button>
                          )
                        )}
                        {/* Expand/Collapse (long content only) */}
                        {isLong && (
                          <button onClick={() => setNotesExpanded(v => !v)}
                            className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-400 dark:text-white/30 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                            <span className="material-symbols-outlined text-[12px]">{notesExpanded ? 'expand_less' : 'expand_more'}</span>
                            {notesExpanded ? (s.collapse || 'Collapse') : (s.expand || 'Expand')}
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Content */}
                    <div className={`relative px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-[11px] text-slate-600 dark:text-white/50 leading-relaxed overflow-hidden transition-all duration-300 ${
                      isLong && !notesExpanded ? 'max-h-36' : 'max-h-[600px]'
                    } overflow-y-auto`}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(notesText) }} />
                    {/* Fade overlay when collapsed */}
                    {isLong && !notesExpanded && (
                      <div className="relative -mt-10 h-10 bg-gradient-to-t from-slate-50 dark:from-[#1c1c1e] to-transparent pointer-events-none rounded-b-lg" />
                    )}
                  </div>
                );
              })()}
              {/* 操作按钮 */}
              {!selfUpdating && !selfUpdateProgress?.done && (
                <div className="flex gap-2">
                  <button onClick={handleSelfUpdateApply} disabled={!selfUpdateInfo.downloadUrl}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-primary text-white text-[12px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
                    <span className="material-symbols-outlined text-[16px]">download</span>
                    {selfUpdateInfo.downloadUrl ? s.selfUpdateDownload : s.selfUpdateNoAsset}
                  </button>
                  <SmartLink href="https://github.com/ClawDeckX/ClawDeckX/releases"
                    className="flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-[12px] font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    {s.viewReleases}
                  </SmartLink>
                </div>
              )}
              {/* 下载进度 */}
              {selfUpdateProgress && !selfUpdateProgress.done && !selfUpdateProgress.error && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-white/30">
                    <span>{selfUpdateProgress.stage === 'downloading' ? s.selfUpdateDownloading : selfUpdateProgress.stage === 'replacing' ? s.selfUpdateApplying : selfUpdateProgress.stage}</span>
                    <span>{Math.round(selfUpdateProgress.percent)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${selfUpdateProgress.percent}%` }} />
                  </div>
                </div>
              )}
              {selfUpdateProgress?.done && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-mac-green/10">
                  <span className="material-symbols-outlined text-[14px] text-mac-green animate-spin">progress_activity</span>
                  <span className="text-[11px] font-bold text-mac-green">{s.selfUpdateDone}</span>
                </div>
              )}
              {selfUpdateProgress?.error && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/5">
                  <span className="material-symbols-outlined text-[14px] text-red-500">error</span>
                  <span className="text-[11px] text-red-500">{s.selfUpdateFailed}: {selfUpdateProgress.error}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 🦞 OpenClaw 更新卡片 ── */}
      <div className={rowCls}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[18px]">🦞</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">OpenClaw</h4>
              <SmartLink href="https://github.com/openclaw/openclaw" className="flex items-center text-slate-400 dark:text-white/30 hover:text-primary transition-colors" title="GitHub">
                <svg className="w-[14px] h-[14px]" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              </SmartLink>
            </div>
            <div className="flex items-center gap-2">
              {serviceStatus && (
                <button
                  onClick={() => serviceStatus.openclaw_installed ? handleServiceUninstall('openclaw') : handleServiceInstall('openclaw')}
                  disabled={serviceLoading}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors flex items-center gap-1 ${
                    serviceStatus.openclaw_installed
                      ? 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-white/60 hover:bg-slate-200 dark:hover:bg-white/10'
                      : 'bg-primary/10 text-primary hover:bg-primary/20'
                  } disabled:opacity-50`}
                >
                  <span className="material-symbols-outlined text-[12px]">{serviceStatus.openclaw_installed ? 'check_circle' : 'add_circle'}</span>
                  {serviceStatus.openclaw_installed ? (s.serviceInstalled || 'Service') : (s.installService || 'Install Service')}
                </button>
              )}
              <span className="font-mono text-[12px] font-bold text-slate-600 dark:text-white/60">
                {ocUpdateInfo?.currentVersion ? `v${ocUpdateInfo.currentVersion}` : '—'}
              </span>
            </div>
          </div>

          {!ocUpdateInfo && !ocUpdateChecking && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-white/30">
              <span className="material-symbols-outlined text-[14px]">info</span>
              {s.openclawUpdateDesc}
            </div>
          )}
          {ocUpdateChecking && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-white/50">
              <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
              {s.openclawUpdateChecking || 'Checking...'}
            </div>
          )}
          {ocUpdateInfo && !ocUpdateInfo.currentVersion && !ocUpdateInfo.error && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="material-symbols-outlined text-[14px] text-amber-500">warning</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">{s.openclawNotInstalled}</span>
            </div>
          )}
          {ocUpdateInfo && !ocUpdateInfo.available && !ocUpdateInfo.error && ocUpdateInfo.currentVersion && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="material-symbols-outlined text-[14px] text-mac-green">check_circle</span>
              <span className="text-mac-green font-medium">{s.openclawUpdateCurrent}</span>
            </div>
          )}
          {ocUpdateInfo?.error && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="material-symbols-outlined text-[14px] text-red-500">error</span>
              <span className="text-red-500">{ocUpdateInfo.error}</span>
            </div>
          )}

          {/* OpenClaw Release Notes — 当前已是最新时也显示 */}
          {ocUpdateInfo && !ocUpdateInfo.available && (ocUpdateInfo.releaseNotes || ocNotesTranslating) && (() => {
            const ocNotes = (ocShowTranslated && ocTranslatedNotes) ? ocTranslatedNotes : (ocUpdateInfo.releaseNotes || '');
            const ocIsLong = ocNotes.length > 600;
            return (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-white/40">
                    <span className="material-symbols-outlined text-[14px]">description</span>
                    {s.selfUpdateReleaseNotes} <span className="font-normal ms-1 text-[10px] text-slate-400 dark:text-white/25">v{ocUpdateInfo.currentVersion}</span>
                    {ocNotesTranslating && <span className="material-symbols-outlined text-[12px] animate-spin text-primary/50 ms-1">progress_activity</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    {language !== 'en' && ocTranslatedNotes && (
                      <button onClick={() => setOcShowTranslated(v => !v)}
                        className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 transition-colors">
                        <span className="material-symbols-outlined text-[12px]">translate</span>
                        {ocShowTranslated ? (s.showOriginal || 'Original') : (s.showTranslation || 'Translated')}
                      </button>
                    )}
                    {ocIsLong && (
                      <button onClick={() => setOcNotesExpanded(v => !v)}
                        className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-400 dark:text-white/30 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                        <span className="material-symbols-outlined text-[12px]">{ocNotesExpanded ? 'expand_less' : 'expand_more'}</span>
                        {ocNotesExpanded ? (s.collapse || 'Collapse') : (s.expand || 'Expand')}
                      </button>
                    )}
                  </div>
                </div>
                {ocUpdateInfo.publishedAt && (
                  <div className="text-[10px] text-slate-400 dark:text-white/30 px-1">
                    {s.updatePublishedAt || 'Published'}: {(() => {
                      const diff = Date.now() - new Date(ocUpdateInfo.publishedAt!).getTime();
                      const mins = Math.floor(diff / 60000);
                      if (mins < 60) return `${mins}m ago`;
                      const hrs = Math.floor(mins / 60);
                      if (hrs < 24) return `${hrs}h ago`;
                      return `${Math.floor(hrs / 24)}d ago`;
                    })()}
                  </div>
                )}
                <div className={`relative px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-[11px] text-slate-600 dark:text-white/50 leading-relaxed overflow-hidden transition-all duration-300 ${
                  ocIsLong && !ocNotesExpanded ? 'max-h-36' : 'max-h-[600px]'
                } overflow-y-auto`}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(ocNotes) }} />
                {ocIsLong && !ocNotesExpanded && (
                  <div className="relative -mt-8 h-8 bg-gradient-to-t from-slate-50 dark:from-[#1c1c1e] to-transparent pointer-events-none rounded-b-lg" />
                )}
              </div>
            );
          })()}

          {ocUpdateInfo?.available && (
            <div className="mt-2 space-y-3">
              <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[14px] text-emerald-500">new_releases</span>
                  <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{s.openclawUpdateAvailable}</span>
                </div>
                <span className="text-[11px] font-mono font-bold text-emerald-600 dark:text-emerald-400">v{ocUpdateInfo.currentVersion} → v{ocUpdateInfo.latestVersion}</span>
              </div>
              {/* OpenClaw Release Notes */}
              {(ocUpdateInfo.releaseNotes || ocNotesTranslating) && (() => {
                const ocNotes = (ocShowTranslated && ocTranslatedNotes) ? ocTranslatedNotes : (ocUpdateInfo.releaseNotes || '');
                const ocIsLong = ocNotes.length > 600;
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-white/40">
                        <span className="material-symbols-outlined text-[14px]">description</span>
                        {s.selfUpdateReleaseNotes}
                        {ocNotesTranslating && <span className="material-symbols-outlined text-[12px] animate-spin text-primary/50 ms-1">progress_activity</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        {language !== 'en' && ocTranslatedNotes && (
                          <button onClick={() => setOcShowTranslated(v => !v)}
                            className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-primary/70 hover:bg-primary/10 transition-colors">
                            <span className="material-symbols-outlined text-[12px]">translate</span>
                            {ocShowTranslated ? (s.showOriginal || 'Original') : (s.showTranslation || 'Translated')}
                          </button>
                        )}
                        {ocIsLong && (
                          <button onClick={() => setOcNotesExpanded(v => !v)}
                            className="flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-400 dark:text-white/30 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors">
                            <span className="material-symbols-outlined text-[12px]">{ocNotesExpanded ? 'expand_less' : 'expand_more'}</span>
                            {ocNotesExpanded ? (s.collapse || 'Collapse') : (s.expand || 'Expand')}
                          </button>
                        )}
                      </div>
                    </div>
                    {ocUpdateInfo.publishedAt && (
                      <div className="text-[10px] text-slate-400 dark:text-white/30 px-1">
                        {s.updatePublishedAt || 'Published'}: {(() => {
                          const diff = Date.now() - new Date(ocUpdateInfo.publishedAt!).getTime();
                          const mins = Math.floor(diff / 60000);
                          if (mins < 60) return `${mins}m ago`;
                          const hrs = Math.floor(mins / 60);
                          if (hrs < 24) return `${hrs}h ago`;
                          const days = Math.floor(hrs / 24);
                          return `${days}d ago`;
                        })()}
                      </div>
                    )}
                    <div className={`relative px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 text-[11px] text-slate-600 dark:text-white/50 leading-relaxed overflow-hidden transition-all duration-300 ${
                      ocIsLong && !ocNotesExpanded ? 'max-h-36' : 'max-h-[600px]'
                    } overflow-y-auto`}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(ocNotes) }} />
                    {ocIsLong && !ocNotesExpanded && (
                      <div className="relative -mt-8 h-8 bg-gradient-to-t from-slate-50 dark:from-[#1c1c1e] to-transparent pointer-events-none rounded-b-lg" />
                    )}
                  </div>
                );
              })()}
              <div className="flex gap-2">
                <button onClick={handleOcUpdateRun} disabled={ocUpdating}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-emerald-500 text-white text-[12px] font-bold disabled:opacity-40 hover:opacity-90 shadow-sm transition-all">
                  <span className={`material-symbols-outlined text-[16px] ${ocUpdating ? 'animate-spin' : ''}`}>{ocUpdating ? 'progress_activity' : 'download'}</span>
                  {ocUpdating ? s.openclawUpdateRunning : s.openclawUpdateRun}
                </button>
                <SmartLink href="https://github.com/openclaw/openclaw/releases"
                  className="flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 text-[12px] font-bold hover:bg-slate-50 dark:hover:bg-white/5 transition-all">
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                  {s.viewReleases}
                </SmartLink>
              </div>
            </div>
          )}
          {/* 升级日志面板 */}
          {(ocUpdating || ocUpdateLogs.length > 0) && (
            <div className="mt-3 bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 rounded-lg overflow-hidden">
              {ocUpdating && (
                <div className="h-1.5 bg-slate-200 dark:bg-white/10">
                  <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${ocUpdateProgress}%` }} />
                </div>
              )}
              {ocUpdateStep && (
                <div className="px-3 py-2 border-b border-slate-200 dark:border-white/10 flex items-center gap-1.5">
                  {ocUpdating && <span className="material-symbols-outlined text-[12px] text-emerald-500 animate-spin">progress_activity</span>}
                  {!ocUpdating && ocUpdateProgress >= 100 && <span className="material-symbols-outlined text-[12px] text-emerald-500">check_circle</span>}
                  <span className="text-[10px] text-slate-600 dark:text-white/60 flex-1 truncate">{ocUpdateStep}</span>
                  {ocUpdating && <span className="text-[9px] text-slate-400 dark:text-white/40">{ocUpdateProgress}%</span>}
                </div>
              )}
              <div ref={ocUpdateLogRef} className="max-h-28 overflow-y-auto px-3 py-2 font-mono text-[10px] text-slate-500 dark:text-white/50 space-y-0.5">
                {ocUpdateLogs.length === 0 && ocUpdating && <div className="text-slate-400 dark:text-white/35">...</div>}
                {ocUpdateLogs.map((line, i) => <div key={i} className="break-all leading-relaxed">{line}</div>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 兼容性状态 */}
      {selfUpdateVersion?.openclawCompat && (
        <div className={rowCls}>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-symbols-outlined text-[16px] text-amber-500/60">verified</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.updateCompat || 'Compatibility'}</h4>
            </div>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-white/[0.03] text-[11px]">
              <span className="text-slate-400 dark:text-white/40">{s.updateCompatReq || 'ClawDeckX requires OpenClaw'}:</span>
              <span className="font-mono font-bold text-slate-700 dark:text-white/70">{selfUpdateVersion.openclawCompat}</span>
              {ocUpdateInfo?.currentVersion && (
                <span className={`ms-auto px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  ocUpdateInfo.currentVersion >= selfUpdateVersion.openclawCompat.replace('>=', '')
                    ? 'bg-mac-green/10 text-mac-green'
                    : 'bg-red-500/10 text-red-500'
                }`}>
                  {ocUpdateInfo.currentVersion >= selfUpdateVersion.openclawCompat.replace('>=', '') ? '✓ ' + (s.aboutCompat || 'Compatible') : '✗ ' + (s.updateIncompat || 'Incompatible')}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 系统环境信息 */}
      {selfUpdateVersion && (
        <div className={rowCls}>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-[16px] text-blue-500/60">computer</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.updateSysInfo || 'System Info'}</h4>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {[
                { label: s.updatePlatform || 'Platform', value: selfUpdateVersion.platform },
                { label: s.updateArch || 'Architecture', value: selfUpdateVersion.arch },
                { label: s.updateGoVer || 'Go Runtime', value: selfUpdateVersion.goVersion },
                { label: s.selfUpdateBuild || 'Build', value: selfUpdateVersion.build },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03]">
                  <span className="text-slate-400 dark:text-white/30">{item.label}</span>
                  <span className="font-mono font-medium text-slate-600 dark:text-white/60">{item.value || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 更新历史 */}
      {updateHistory.length > 0 && (
        <div className={rowCls}>
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="material-symbols-outlined text-[16px] text-purple-500/60">history</span>
              <h4 className="text-[13px] font-bold text-slate-700 dark:text-white/70">{s.updateHistory || 'Update History'}</h4>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {updateHistory.map(entry => (
                <div key={entry.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 dark:bg-white/[0.03] text-[11px]">
                  <span className={`material-symbols-outlined text-[14px] ${entry.result === 'success' ? 'text-mac-green' : 'text-red-500'}`}>
                    {entry.result === 'success' ? 'check_circle' : 'error'}
                  </span>
                  <span className="flex-1 truncate text-slate-600 dark:text-white/60">{entry.detail || entry.result}</span>
                  <span className="text-[10px] text-slate-400 dark:text-white/30 shrink-0">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UpdateTab;

