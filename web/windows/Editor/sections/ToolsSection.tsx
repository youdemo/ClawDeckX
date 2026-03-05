import React, { useMemo } from 'react';
import { SectionProps } from '../sectionTypes';
import { ConfigSection, TextField, NumberField, SelectField, SwitchField, ArrayField, KeyValueField } from '../fields';
import { getTranslation } from '../../../locales';
import { getTooltip } from '../../../locales/tooltips';

// Options moved inside component

export const ToolsSection: React.FC<SectionProps> = ({ setField, getField, language }) => {
  const es = useMemo(() => (getTranslation(language) as any).es || {}, [language]);
  const tip = (key: string) => getTooltip(key, language);
  const g = (p: string[]) => getField(['tools', ...p]);
  const s = (p: string[], v: any) => setField(['tools', ...p], v);

  const PROFILE_OPTIONS = useMemo(() => [
    { value: 'minimal', label: es.profileMinimal }, { value: 'coding', label: es.profileCoding },
    { value: 'messaging', label: es.profileMessaging }, { value: 'full', label: es.profileFull },
  ], [es]);

  const EXEC_HOST_OPTIONS = useMemo(() => [
    { value: 'local', label: es.optLocal }, { value: 'docker', label: es.optDocker }, { value: 'ssh', label: es.optSsh },
  ], [es]);

  const EXEC_SECURITY_OPTIONS = useMemo(() => [
    { value: 'standard', label: es.optStandard }, { value: 'strict', label: es.optStrict }, { value: 'permissive', label: es.optPermissive },
  ], [es]);

  return (
    <div className="space-y-4">
      <ConfigSection title={es.toolProfile} icon="dashboard_customize" iconColor="text-orange-500">
        <SelectField label={es.profile} desc={es.profileDesc} tooltip={tip('tools.profile')} value={g(['profile']) || 'full'} onChange={v => s(['profile'], v)} options={PROFILE_OPTIONS} />
        <ArrayField label={es.allowList} tooltip={tip('tools.allow')} value={g(['allow']) || []} onChange={v => s(['allow'], v)} placeholder={es.phToolName} />
        <ArrayField label={es.denyList} tooltip={tip('tools.deny')} value={g(['deny']) || []} onChange={v => s(['deny'], v)} placeholder={es.phToolName} />
      </ConfigSection>

      <ConfigSection title={es.exec} icon="terminal" iconColor="text-red-500">
        <SelectField label={es.execHost} tooltip={tip('tools.exec.host')} value={g(['exec', 'host']) || 'local'} onChange={v => s(['exec', 'host'], v)} options={EXEC_HOST_OPTIONS} />
        <SelectField label={es.security} tooltip={tip('tools.exec.security')} value={g(['exec', 'security']) || 'standard'} onChange={v => s(['exec', 'security'], v)} options={EXEC_SECURITY_OPTIONS} />
        <SwitchField label={es.askBeforeExec} tooltip={tip('tools.exec.ask')} value={g(['exec', 'ask']) !== false} onChange={v => s(['exec', 'ask'], v)} />
        <NumberField label={es.timeoutS} tooltip={tip('tools.exec.timeout')} value={g(['exec', 'timeout'])} onChange={v => s(['exec', 'timeout'], v)} min={0} />
        <ArrayField label={es.safeBins} desc={es.safeBinsDesc} tooltip={tip('tools.exec.safeBins')} value={g(['exec', 'safeBins']) || []} onChange={v => s(['exec', 'safeBins'], v)} placeholder={es.phSafeBins} />
      </ConfigSection>

      <ConfigSection title={es.media} icon="image" iconColor="text-pink-500" defaultOpen={false}>
        <SwitchField label={es.imageUnderstanding} tooltip={tip('tools.media.image.enabled')} value={g(['media', 'image', 'enabled']) !== false} onChange={v => s(['media', 'image', 'enabled'], v)} />
        <SwitchField label={es.audioUnderstanding} tooltip={tip('tools.media.audio.enabled')} value={g(['media', 'audio', 'enabled']) !== false} onChange={v => s(['media', 'audio', 'enabled'], v)} />
        <SwitchField label={es.videoUnderstanding} tooltip={tip('tools.media.video.enabled')} value={g(['media', 'video', 'enabled']) !== false} onChange={v => s(['media', 'video', 'enabled'], v)} />
      </ConfigSection>

      <ConfigSection title={es.pdfConfig || 'PDF'} icon="picture_as_pdf" iconColor="text-red-400" defaultOpen={false}>
        <TextField label={es.pdfModel || 'PDF Model'} tooltip={tip('tools.pdf.model')} value={g(['pdf', 'model']) || ''} onChange={v => s(['pdf', 'model'], v)} placeholder="gpt-4o-mini" />
        <NumberField label={es.pdfMaxBytes || 'PDF Max Bytes'} tooltip={tip('tools.pdf.maxBytes')} value={g(['pdf', 'maxBytes'])} onChange={v => s(['pdf', 'maxBytes'], v)} placeholder="10485760" />
        <NumberField label={es.pdfMaxPages || 'PDF Max Pages'} tooltip={tip('tools.pdf.maxPages')} value={g(['pdf', 'maxPages'])} onChange={v => s(['pdf', 'maxPages'], v)} placeholder="50" />
      </ConfigSection>

      <ConfigSection title={es.elevatedTools} icon="admin_panel_settings" iconColor="text-amber-500" defaultOpen={false}>
        <ArrayField label={es.allowedElevated} tooltip={tip('tools.elevated.allow')} value={g(['elevated', 'allow']) || []} onChange={v => s(['elevated', 'allow'], v)} placeholder={es.phToolName} />
      </ConfigSection>

      <ConfigSection title={es.agentToAgent} icon="swap_horiz" iconColor="text-violet-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('tools.agentToAgent.enabled')} value={g(['agentToAgent', 'enabled']) === true} onChange={v => s(['agentToAgent', 'enabled'], v)} />
      </ConfigSection>

      <ConfigSection title={es.canvasHost} icon="draw" iconColor="text-purple-500" defaultOpen={false}>
        <SwitchField label={es.enabled} tooltip={tip('canvasHost.enabled')} value={getField(['canvasHost', 'enabled']) === true} onChange={v => setField(['canvasHost', 'enabled'], v)} />
        <TextField label={es.root} tooltip={tip('canvasHost.root')} value={getField(['canvasHost', 'root']) || ''} onChange={v => setField(['canvasHost', 'root'], v)} />
        <NumberField label={es.port} tooltip={tip('canvasHost.port')} value={getField(['canvasHost', 'port'])} onChange={v => setField(['canvasHost', 'port'], v)} min={1} max={65535} />
        <SwitchField label={es.liveReload} tooltip={tip('canvasHost.liveReload')} value={getField(['canvasHost', 'liveReload']) !== false} onChange={v => setField(['canvasHost', 'liveReload'], v)} />
      </ConfigSection>

      <ConfigSection title={es.mediaFiles} icon="perm_media" iconColor="text-orange-500" defaultOpen={false}>
        <SwitchField label={es.preserveFilenames} tooltip={tip('media.preserveFilenames')} value={getField(['media', 'preserveFilenames']) === true} onChange={v => setField(['media', 'preserveFilenames'], v)} />
      </ConfigSection>
    </div>
  );
};
