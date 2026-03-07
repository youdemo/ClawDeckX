package openclaw

import (
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/output"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const defaultGatewayPort = "18789"

type Runtime string

const (
	RuntimeSystemd Runtime = "systemd"
	RuntimeDocker  Runtime = "docker"
	RuntimeProcess Runtime = "process"
	RuntimeUnknown Runtime = "unknown"
)

type Status struct {
	Runtime Runtime
	Running bool
	Detail  string
}

type Service struct {
	dockerContainer  string
	GatewayHost      string
	GatewayPort      int
	GatewayToken     string
	gwClient         *GWClient // control gateway via JSON-RPC in remote mode
	runtimeCache     Runtime
	runtimeCacheTime time.Time
	runtimeCacheTTL  time.Duration
}

func NewService() *Service {
	return &Service{
		GatewayHost:     "127.0.0.1",
		GatewayPort:     18789,
		runtimeCacheTTL: 1 * time.Hour, // runtime type cache 1 hour (rarely changes)
	}
}

func (s *Service) SetGWClient(client *GWClient) {
	s.gwClient = client
}

func (s *Service) IsRemote() bool {
	h := strings.TrimSpace(s.GatewayHost)
	return h != "" && h != "127.0.0.1" && h != "localhost" && h != "::1"
}

func (s *Service) DetectRuntime() Runtime {
	if time.Since(s.runtimeCacheTime) < s.runtimeCacheTTL && s.runtimeCache != RuntimeUnknown {
		logger.Gateway.Debug().
			Str("cached_runtime", string(s.runtimeCache)).
			Dur("cache_age", time.Since(s.runtimeCacheTime)).
			Msg(i18n.T(i18n.MsgLogDetectRuntimeUsingCache))
		return s.runtimeCache
	}

	rt := s.detectRuntimeImpl()

	s.runtimeCache = rt
	s.runtimeCacheTime = time.Now()

	return rt
}

func (s *Service) detectRuntimeImpl() Runtime {
	hasSystemctl := commandExists("systemctl")
	systemdRunning := systemdActive("openclaw")
	logger.Gateway.Debug().
		Bool("hasSystemctl", hasSystemctl).
		Bool("systemdActive", systemdRunning).
		Msg(i18n.T(i18n.MsgLogDetectRuntimeSystemd))
	if hasSystemctl && systemdRunning {
		return RuntimeSystemd
	}

	hasDocker := commandExists("docker")
	dockerName := ""
	if hasDocker {
		dockerName = findDockerContainer()
	}
	logger.Gateway.Debug().
		Bool("hasDocker", hasDocker).
		Str("containerName", dockerName).
		Msg(i18n.T(i18n.MsgLogDetectRuntimeDocker))
	if dockerName != "" {
		s.dockerContainer = dockerName
		return RuntimeDocker
	}

	procExists := processExists()
	portListening := gatewayPortListening()
	hasOpenclawCmd := commandExists("openclaw")
	logger.Gateway.Debug().
		Bool("processExists", procExists).
		Bool("portListening", portListening).
		Bool("hasOpenclawCmd", hasOpenclawCmd).
		Msg(i18n.T(i18n.MsgLogDetectRuntimeProcess))
	if procExists || portListening || hasOpenclawCmd {
		return RuntimeProcess
	}

	logger.Gateway.Warn().Msg(i18n.T(i18n.MsgLogDetectRuntimeFailed))
	return RuntimeUnknown
}

func (s *Service) Status() Status {
	if s.IsRemote() {
		return s.remoteStatus()
	}

	rt := s.DetectRuntime()

	running := s.isRunning()

	var detail string
	switch rt {
	case RuntimeSystemd:
		detail = i18n.T(i18n.MsgServiceRuntimeSystemd)
	case RuntimeDocker:
		name := s.ensureContainerName()
		if name == "" {
			return Status{Runtime: RuntimeUnknown, Running: false, Detail: i18n.T(i18n.MsgServiceRuntimeDockerNotFound)}
		}
		detail = i18n.T(i18n.MsgServiceRuntimeDockerContainer, map[string]interface{}{"Name": name})
	case RuntimeProcess:
		detail = i18n.T(i18n.MsgServiceRuntimeProcess)
	default:
		detail = i18n.T(i18n.MsgServiceRuntimeUnknown)
	}

	if running {
		detail += i18n.T(i18n.MsgServiceRuntimeRunning)
	}

	return Status{Runtime: rt, Running: running, Detail: detail}
}

func (s *Service) isRunning() bool {
	return processExists() || gatewayPortListening()
}

func (s *Service) remoteStatus() Status {
	port := s.GatewayPort
	if port == 0 {
		port = 18789
	}
	addr := fmt.Sprintf("%s:%d", s.GatewayHost, port)

	conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
	if err != nil {
		return Status{
			Runtime: RuntimeProcess,
			Running: false,
			Detail:  i18n.T(i18n.MsgServiceRemoteGatewayUnreachable, map[string]interface{}{"Addr": addr, "Error": err.Error()}),
		}
	}
	conn.Close()

	detail := i18n.T(i18n.MsgServiceRemoteGatewayTcpReachable, map[string]interface{}{"Addr": addr})
	client := &http.Client{Timeout: 3 * time.Second}
	url := fmt.Sprintf("http://%s/health", addr)
	resp, err := client.Get(url)
	if err == nil {
		resp.Body.Close()
		if resp.StatusCode < 500 {
			detail = i18n.T(i18n.MsgServiceRemoteGatewayHttpOk, map[string]interface{}{"Addr": addr, "Code": resp.StatusCode})
		}
	}

	return Status{
		Runtime: RuntimeProcess,
		Running: true,
		Detail:  detail,
	}
}

func (s *Service) Start() error {
	if s.IsRemote() {
		return errors.New(i18n.T(i18n.MsgErrRemoteGatewayNoStart))
	}
	// Skip if gateway is already running to avoid duplicate processes
	st := s.Status()
	if st.Running {
		logger.Gateway.Info().Str("detail", st.Detail).Msg("gateway already running, skipping start")
		return nil
	}
	switch s.DetectRuntime() {
	case RuntimeSystemd:
		return runCommand("systemctl", "--user", "start", "openclaw-gateway")
	case RuntimeDocker:
		name := s.ensureContainerName()
		if name == "" {
			return errors.New(i18n.T(i18n.MsgErrContainerNotFound))
		}
		return runCommand("docker", "start", name)
	case RuntimeProcess:
		cmdName := ResolveOpenClawCmd()
		if cmdName == "" {
			return errors.New(i18n.T(i18n.MsgErrCommandNotFound))
		}

		port := defaultGatewayPort
		bind := "loopback"
		cfgPath := ResolveConfigPath()
		if cfgPath != "" {
			if p := configGatewayPort(cfgPath); p != "" {
				port = p
			}
			if b := configGatewayBind(cfgPath); b != "" {
				bind = b
			}
		}

		if runtime.GOOS == "windows" {
			return s.startWindowsGateway(cmdName, bind, port)
		}
		return runCommand("sh", "-c", fmt.Sprintf("nohup %s gateway run --bind %s --port %s > /tmp/openclaw-gateway.log 2>&1 &", cmdName, bind, port))
	default:
		return errors.New(i18n.T(i18n.MsgErrUnknownRuntimeStart))
	}
}

func (s *Service) Stop() error {
	if s.IsRemote() {
		return errors.New(i18n.T(i18n.MsgErrRemoteGatewayNoStop))
	}
	switch s.DetectRuntime() {
	case RuntimeSystemd:
		return runCommand("systemctl", "--user", "stop", "openclaw-gateway")
	case RuntimeDocker:
		name := s.ensureContainerName()
		if name == "" {
			return errors.New(i18n.T(i18n.MsgErrContainerNotFound))
		}
		return runCommand("docker", "stop", name)
	case RuntimeProcess:
		// Step 1: try the CLI graceful stop command
		cmdName := ResolveOpenClawCmd()
		if cmdName != "" {
			if err := runCommand(cmdName, "gateway", "stop"); err == nil {
				if waitGatewayDown(5, 700*time.Millisecond) {
					return nil
				}
			}
		}
		// Step 2: graceful signal — SIGTERM (Unix) / taskkill without /F (Windows)
		if runtime.GOOS == "windows" {
			_ = runCommand("taskkill", "/IM", "openclaw.exe")
		} else {
			_ = runCommand("pkill", "-SIGTERM", "-f", "openclaw-gateway")
			_ = runCommand("pkill", "-SIGTERM", "-f", "openclaw gateway")
		}
		// Grace period: wait up to 3 seconds for graceful exit
		if waitGatewayDown(6, 500*time.Millisecond) {
			return nil
		}
		// Step 3: force kill as last resort
		if runtime.GOOS == "windows" {
			_ = runCommand("taskkill", "/F", "/IM", "openclaw.exe")
			_ = runCommand("powershell", "-NoProfile", "-Command",
				"Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'openclaw' -and $_.CommandLine -match 'gateway' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
		} else {
			_ = runCommand("pkill", "-SIGKILL", "-f", "openclaw-gateway")
			_ = runCommand("pkill", "-SIGKILL", "-f", "openclaw gateway")
		}
		if waitGatewayDown(5, 700*time.Millisecond) {
			return nil
		}
		return errors.New(i18n.T(i18n.MsgErrStopGatewayTimeout))
	default:
		return errors.New(i18n.T(i18n.MsgErrUnknownRuntimeStop))
	}
}

func waitGatewayDown(maxAttempts int, interval time.Duration) bool {
	if maxAttempts <= 0 {
		maxAttempts = 1
	}
	for i := 0; i < maxAttempts; i++ {
		if !processExists() && !gatewayPortListening() {
			return true
		}
		time.Sleep(interval)
	}
	return false
}

func (s *Service) Restart() error {
	if s.gwClient != nil && s.gwClient.IsConnected() {
		return s.gwClientRestart()
	}
	if s.IsRemote() {
		return errors.New(i18n.T(i18n.MsgErrRemoteGatewayNotConnected))
	}
	rt := s.DetectRuntime()
	logger.Gateway.Debug().Str("runtime", fmt.Sprintf("%v", rt)).Msg(i18n.T(i18n.MsgLogRestartDetectedRuntime))
	switch rt {
	case RuntimeSystemd:
		return runCommand("systemctl", "--user", "restart", "openclaw-gateway")
	case RuntimeDocker:
		name := s.ensureContainerName()
		if name == "" {
			return errors.New(i18n.T(i18n.MsgErrContainerNotFound))
		}
		return runCommand("docker", "restart", name)
	case RuntimeProcess:
		if commandExists("openclaw") {
			if err := runCommand("openclaw", "gateway", "restart"); err == nil {
				return nil
			}
		}
		_ = s.Stop()
		return s.Start()
	default:
		logger.Gateway.Error().
			Str("runtime", fmt.Sprintf("%v", rt)).
			Msg(i18n.T(i18n.MsgLogRestartUnknownRuntime))
		return errors.New(i18n.T(i18n.MsgErrUnknownRuntimeRestart))
	}
}

func (s *Service) gwClientRestart() error {
	cfgData, err := s.gwClient.RequestWithTimeout("config.get", map[string]interface{}{}, 10*time.Second)
	if err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrGetGatewayConfigFailed), err)
	}
	var baseHash string
	if len(cfgData) > 0 {
		var result map[string]interface{}
		if err := json.Unmarshal(cfgData, &result); err == nil {
			if h, ok := result["hash"].(string); ok {
				baseHash = h
			}
		}
	}
	params := map[string]interface{}{
		"raw":            "{}",
		"restartDelayMs": 0,
		"note":           "ClawDeckX restart",
	}
	if baseHash != "" {
		params["baseHash"] = baseHash
	}
	_, err = s.gwClient.RequestWithTimeout("config.patch", params, 15*time.Second)
	if err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrGatewayRestartFailed), err)
	}
	return nil
}

func (s *Service) ensureContainerName() string {
	if s.dockerContainer != "" {
		return s.dockerContainer
	}
	s.dockerContainer = findDockerContainer()
	return s.dockerContainer
}

func systemdActive(name string) bool {
	return runOk("systemctl", "--user", "is-active", "--quiet", name)
}

func findDockerContainer() string {
	out, err := runOutput("docker", "ps", "-a", "--format", "{{.Names}}")
	if err != nil {
		return ""
	}
	lines := strings.Split(out, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.Contains(strings.ToLower(line), "openclaw") {
			return line
		}
	}
	return ""
}

func processExists() bool {
	if runtime.GOOS == "windows" {
		return processExistsWindows()
	}
	return processExistsUnix()
}

func processExistsWindows() bool {
	out, err := runOutput("powershell", "-NoProfile", "-Command",
		"Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object -ExpandProperty CommandLine")
	if err == nil {
		for _, line := range strings.Split(out, "\n") {
			lower := strings.ToLower(strings.TrimSpace(line))
			if strings.Contains(lower, "openclaw") && strings.Contains(lower, "gateway") {
				return true
			}
		}
	}

	out, err = runOutput("wmic", "process", "where", "name='node.exe'", "get", "commandline")
	if err == nil {
		for _, line := range strings.Split(out, "\n") {
			lower := strings.ToLower(strings.TrimSpace(line))
			if lower == "" || lower == "commandline" {
				continue
			}
			if strings.Contains(lower, "openclaw") && strings.Contains(lower, "gateway") {
				return true
			}
		}
	}

	return false
}

func processExistsUnix() bool {
	out, err := runOutput("ps", "-eo", "args=")
	if err != nil {
		return false
	}
	for _, line := range strings.Split(out, "\n") {
		lower := strings.ToLower(strings.TrimSpace(line))
		if lower == "" {
			continue
		}
		if strings.Contains(lower, "openclaw-gateway") {
			return true
		}
		if strings.Contains(lower, "openclaw gateway") {
			return true
		}
		if strings.Contains(lower, "/openclaw") && strings.Contains(lower, "gateway") {
			return true
		}
	}
	return false
}

func gatewayPortListening() bool {
	ports := gatewayPortsToCheck()
	for _, port := range ports {
		if portListedBySocketTools(port) {
			return true
		}
	}
	return false
}

func gatewayPortsToCheck() []string {
	ports := []string{defaultGatewayPort}
	if p := strings.TrimSpace(os.Getenv("OPENCLAW_GATEWAY_PORT")); p != "" {
		ports = append(ports, p)
	}

	if cfgPath := ResolveConfigPath(); cfgPath != "" {
		if p := configGatewayPort(cfgPath); p != "" {
			ports = append(ports, p)
		}
	}
	return dedupPorts(ports)
}

func configGatewayPort(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return ""
	}
	gw, ok := raw["gateway"].(map[string]any)
	if !ok {
		return ""
	}
	switch v := gw["port"].(type) {
	case float64:
		if v > 0 {
			return fmt.Sprintf("%d", int(v))
		}
	case string:
		return strings.TrimSpace(v)
	}
	return ""
}

func configGatewayBind(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return ""
	}
	gw, ok := raw["gateway"].(map[string]any)
	if !ok {
		return ""
	}
	if v, ok := gw["bind"].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func (s *Service) startWindowsGateway(cmdName, bind, port string) error {
	stateDir := ResolveStateDir()
	if stateDir == "" {
		stateDir = filepath.Join(os.TempDir(), ".openclaw")
	}
	logDir := filepath.Join(stateDir, "logs")
	os.MkdirAll(logDir, 0o700)
	logPath := filepath.Join(logDir, "gateway.log")

	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		logFile, _ = os.Open(os.DevNull)
	}

	c := exec.Command(cmdName, "gateway", "run", "--bind", bind, "--port", port)
	c.Stdout = logFile
	c.Stderr = logFile
	c.Stdin = nil

	// CREATE_NEW_PROCESS_GROUP (0x200) | DETACHED_PROCESS (0x8)
	c.SysProcAttr = &sysProcAttrDetached

	if err := c.Start(); err != nil {
		logFile.Close()
		return fmt.Errorf(i18n.T(i18n.MsgErrStartGatewayProcessFailed), err)
	}

	go func() {
		c.Wait()
		logFile.Close()
	}()

	for i := 0; i < 30; i++ {
		time.Sleep(500 * time.Millisecond)
		if gatewayPortListening() {
			output.Debugf("Gateway started on port %s\n", port)
			return nil
		}
	}

	output.Debugf("Gateway start command executed, log: %s\n", logPath)
	return nil
}

func dedupPorts(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, p := range in {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func runOk(cmd string, args ...string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, cmd, args...)
	c.SysProcAttr = &sysProcAttrDetached
	err := c.Run()
	if err != nil {
		output.Debugf("Command failed: %s %s err=%s\n", cmd, strings.Join(args, " "), err)
		return false
	}
	return true
}

func runCommand(cmd string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, cmd, args...)
	c.SysProcAttr = &sysProcAttrDetached
	out, err := c.CombinedOutput()
	if err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrCommandFailed), cmd, strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	output.Debugf("Command succeeded: %s %s\n", cmd, strings.Join(args, " "))
	return nil
}

func runOutput(cmd string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, cmd, args...)
	c.SysProcAttr = &sysProcAttrDetached
	out, err := c.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func portListedBySocketTools(port string) bool {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:"+port, time.Second)
	if err == nil {
		conn.Close()
		return true
	}

	if runtime.GOOS == "windows" {
		// Windows: netstat -an
		if out, err := runOutput("netstat", "-an"); err == nil {
			for _, line := range strings.Split(out, "\n") {
				if strings.Contains(line, ":"+port) && strings.Contains(strings.ToUpper(line), "LISTENING") {
					return true
				}
			}
		}
	} else {
		// Linux/macOS: ss or netstat
		if out, err := runOutput("ss", "-lnt"); err == nil {
			if strings.Contains(out, ":"+port) {
				return true
			}
		}
		if out, err := runOutput("netstat", "-lnt"); err == nil {
			if strings.Contains(out, ":"+port) {
				return true
			}
		}
	}
	return false
}

// ──────────────────────── Daemon (system service) management ────────────────────────

// DaemonStatusResult describes the OS-level service registration state.
type DaemonStatusResult struct {
	Platform  string `json:"platform"`  // "systemd" | "launchd" | "windows" | "unsupported"
	Installed bool   `json:"installed"` // whether the service unit/plist/sc entry exists
	Enabled   bool   `json:"enabled"`   // whether it auto-starts on boot
	Active    bool   `json:"active"`    // whether it is currently running via the service manager
	UnitFile  string `json:"unitFile"`  // path to the unit/plist file (empty on windows/unsupported)
	Detail    string `json:"detail"`
}

// DaemonStatus checks if openclaw is registered as an OS-level service.
func (s *Service) DaemonStatus() DaemonStatusResult {
	switch runtime.GOOS {
	case "linux":
		return s.daemonStatusSystemd()
	case "darwin":
		return s.daemonStatusLaunchd()
	case "windows":
		return s.daemonStatusWindows()
	default:
		return DaemonStatusResult{Platform: "unsupported", Detail: "OS not supported for daemon management"}
	}
}

// DaemonInstall registers openclaw as an OS-level service.
// It first cleans up any legacy service registrations before installing.
func (s *Service) DaemonInstall() error {
	if s.IsRemote() {
		return errors.New(i18n.T(i18n.MsgErrDaemonRemoteInstall))
	}
	s.cleanupLegacyServices()
	switch runtime.GOOS {
	case "linux":
		return s.daemonInstallSystemd()
	case "darwin":
		return s.daemonInstallLaunchd()
	case "windows":
		return s.daemonInstallWindows()
	default:
		return errors.New(i18n.T(i18n.MsgErrDaemonUnsupportedOS))
	}
}

// cleanupLegacyServices removes old-style service registrations that are no longer used.
func (s *Service) cleanupLegacyServices() {
	switch runtime.GOOS {
	case "linux":
		// Clean up old system-level systemd unit if it exists
		const legacySystemdPath = "/etc/systemd/system/openclaw-gateway.service"
		if _, err := os.Stat(legacySystemdPath); err == nil {
			output.Debugf(i18n.T(i18n.MsgDaemonLegacySystemd)+"\n", legacySystemdPath)
			_ = runCommand("sudo", "systemctl", "stop", "openclaw-gateway")
			_ = runCommand("sudo", "systemctl", "disable", "openclaw-gateway")
			_ = runCommand("sudo", "rm", "-f", legacySystemdPath)
			_ = runCommand("sudo", "systemctl", "daemon-reload")
		}
	case "windows":
		// Clean up old sc.exe Windows service if it exists
		const legacyServiceName = "OpenClawGateway"
		if out, err := runOutput("sc", "query", legacyServiceName); err == nil && strings.Contains(strings.ToUpper(out), legacyServiceName) {
			output.Debugf(i18n.T(i18n.MsgDaemonLegacyWinService)+"\n", legacyServiceName)
			_ = runCommand("sc", "stop", legacyServiceName)
			_ = runCommand("sc", "delete", legacyServiceName)
		}
	}
}

// DaemonUninstall removes the OS-level service registration.
func (s *Service) DaemonUninstall() error {
	if s.IsRemote() {
		return errors.New(i18n.T(i18n.MsgErrDaemonRemoteUninstall))
	}
	switch runtime.GOOS {
	case "linux":
		return s.daemonUninstallSystemd()
	case "darwin":
		return s.daemonUninstallLaunchd()
	case "windows":
		return s.daemonUninstallWindows()
	default:
		return errors.New(i18n.T(i18n.MsgErrDaemonUnsupportedOS))
	}
}

// ── systemd ──

const systemdServiceName = "openclaw-gateway"

func systemdUserUnitPath() string {
	home, _ := os.UserHomeDir()
	if home == "" {
		return ""
	}
	return filepath.Join(home, ".config", "systemd", "user", systemdServiceName+".service")
}

func (s *Service) daemonStatusSystemd() DaemonStatusResult {
	unitPath := systemdUserUnitPath()
	res := DaemonStatusResult{Platform: "systemd", UnitFile: unitPath}
	if unitPath == "" {
		res.Detail = i18n.T(i18n.MsgDaemonStatusSystemdNoHome)
		return res
	}
	if _, err := os.Stat(unitPath); err == nil {
		res.Installed = true
	}
	if runOk("systemctl", "--user", "is-enabled", "--quiet", systemdServiceName) {
		res.Enabled = true
	}
	if systemdActive(systemdServiceName) || systemdActive("openclaw") {
		res.Active = true
	}
	if res.Installed {
		res.Detail = i18n.T(i18n.MsgDaemonStatusSystemdInstalled)
		if res.Enabled {
			res.Detail += i18n.T(i18n.MsgDaemonStatusAutoStart)
		}
		if res.Active {
			res.Detail += i18n.T(i18n.MsgDaemonStatusActive)
		}
	} else {
		res.Detail = i18n.T(i18n.MsgDaemonStatusSystemdNotInst)
	}
	return res
}

func isWSL2() bool {
	out, err := os.ReadFile("/proc/version")
	if err != nil {
		return false
	}
	lower := strings.ToLower(string(out))
	return strings.Contains(lower, "microsoft") || strings.Contains(lower, "wsl")
}

func systemdUserAvailable() bool {
	return runOk("systemctl", "--user", "status")
}

func checkLingerStatus() (enabled bool, user string) {
	user = os.Getenv("USER")
	if user == "" {
		user = os.Getenv("LOGNAME")
	}
	if user == "" {
		return false, ""
	}
	out, err := runOutput("loginctl", "show-user", user, "-p", "Linger")
	if err != nil {
		return false, user
	}
	return strings.Contains(strings.ToLower(out), "linger=yes"), user
}

// ReadLastGatewayError reads the gateway log and returns the last known error line.
func ReadLastGatewayError() string {
	stateDir := ResolveStateDir()
	if stateDir == "" {
		return ""
	}
	logFiles := []string{
		filepath.Join(stateDir, "logs", "gateway-err.log"),
		filepath.Join(stateDir, "logs", "gateway.log"),
		"/tmp/openclaw-gateway.log",
	}
	errorPatterns := []string{
		"refusing to bind",
		"failed to bind",
		"address already in use",
		"permission denied",
		"auth mode",
		"gateway start blocked",
		"EADDRINUSE",
		"EACCES",
	}
	for _, logFile := range logFiles {
		data, err := os.ReadFile(logFile)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		for i := len(lines) - 1; i >= 0; i-- {
			line := strings.TrimSpace(lines[i])
			if line == "" {
				continue
			}
			lower := strings.ToLower(line)
			for _, pattern := range errorPatterns {
				if strings.Contains(lower, pattern) {
					return line
				}
			}
		}
	}
	return ""
}

func (s *Service) daemonInstallSystemd() error {
	unitPath := systemdUserUnitPath()
	if unitPath == "" {
		return errors.New(i18n.T(i18n.MsgErrDaemonNoHomeDir))
	}

	// Check if systemd user services are available
	useSystemLevel := false
	if !systemdUserAvailable() {
		if isWSL2() {
			return errors.New(i18n.T(i18n.MsgErrDaemonSystemdWSL2))
		}
		// Fallback to system-level systemd service
		if !commandExists("sudo") {
			return errors.New(i18n.T(i18n.MsgErrDaemonSystemdUnavailable))
		}
		useSystemLevel = true
		logger.Gateway.Info().Msg("systemd user service unavailable, using system-level service (requires sudo)")
	}

	cmdName := ResolveOpenClawCmd()
	if cmdName == "" {
		return errors.New(i18n.T(i18n.MsgErrDaemonCmdNotFound))
	}
	absCmd, _ := exec.LookPath(cmdName)
	if absCmd == "" {
		absCmd = cmdName
	}

	port := defaultGatewayPort
	bind := "loopback"
	if cfgPath := ResolveConfigPath(); cfgPath != "" {
		if p := configGatewayPort(cfgPath); p != "" {
			port = p
		}
		if b := configGatewayBind(cfgPath); b != "" {
			bind = b
		}
	}

	unit := fmt.Sprintf(`[Unit]
Description=OpenClaw Gateway
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=%s gateway run --bind %s --port %s
Restart=always
RestartSec=5
KillMode=control-group
WorkingDirectory=%s

[Install]
WantedBy=default.target
`, absCmd, bind, port, filepath.Dir(absCmd))

	if useSystemLevel {
		return s.installSystemLevelSystemd(unit, absCmd)
	}

	if err := os.MkdirAll(filepath.Dir(unitPath), 0755); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrDaemonCreateDir), err)
	}
	// Backup existing unit file
	if _, err := os.Stat(unitPath); err == nil {
		_ = copyFile(unitPath, unitPath+".bak")
	}
	if err := os.WriteFile(unitPath, []byte(unit), 0644); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrDaemonWriteUnit), err)
	}
	if err := runCommand("systemctl", "--user", "daemon-reload"); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrDaemonReload), err)
	}
	if err := runCommand("systemctl", "--user", "enable", systemdServiceName); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrDaemonEnable), err)
	}
	// Enable linger so user services survive logout
	lingerOk, lingerUser := checkLingerStatus()
	if !lingerOk && lingerUser != "" {
		if err := runCommand("loginctl", "enable-linger", lingerUser); err != nil {
			output.Debugf(i18n.T(i18n.MsgDaemonLingerWarning)+"\n", lingerUser, err)
			output.Debugf(i18n.T(i18n.MsgDaemonLingerHint)+"\n", lingerUser)
		}
	}
	return nil
}

func (s *Service) installSystemLevelSystemd(unit, absCmd string) error {
	systemPath := "/etc/systemd/system/openclaw-gateway.service"
	tmpFile := "/tmp/openclaw-gateway.service"

	if err := os.WriteFile(tmpFile, []byte(unit), 0644); err != nil {
		return fmt.Errorf("failed to write temp unit file: %w", err)
	}

	if err := runCommand("sudo", "mv", tmpFile, systemPath); err != nil {
		return fmt.Errorf("failed to install system service (sudo required): %w", err)
	}
	if err := runCommand("sudo", "systemctl", "daemon-reload"); err != nil {
		return fmt.Errorf("failed to reload systemd: %w", err)
	}
	if err := runCommand("sudo", "systemctl", "enable", "openclaw-gateway"); err != nil {
		return fmt.Errorf("failed to enable service: %w", err)
	}

	logger.Gateway.Info().Msg("system-level systemd service installed successfully")
	return nil
}

func (s *Service) daemonUninstallSystemd() error {
	// Try user-level first
	_ = runCommand("systemctl", "--user", "stop", systemdServiceName)
	_ = runCommand("systemctl", "--user", "disable", systemdServiceName)
	unitPath := systemdUserUnitPath()
	if unitPath != "" {
		_ = os.Remove(unitPath)
	}
	_ = runCommand("systemctl", "--user", "daemon-reload")

	// Also try system-level
	systemPath := "/etc/systemd/system/openclaw-gateway.service"
	if _, err := os.Stat(systemPath); err == nil {
		_ = runCommand("sudo", "systemctl", "stop", "openclaw-gateway")
		_ = runCommand("sudo", "systemctl", "disable", "openclaw-gateway")
		_ = runCommand("sudo", "rm", "-f", systemPath)
		_ = runCommand("sudo", "systemctl", "daemon-reload")
	}

	return nil
}

// ── launchd ──

const launchdLabel = "ai.openclaw.gateway"

func launchdPlistPath() string {
	home, _ := os.UserHomeDir()
	if home == "" {
		return ""
	}
	return filepath.Join(home, "Library", "LaunchAgents", launchdLabel+".plist")
}

func (s *Service) daemonStatusLaunchd() DaemonStatusResult {
	plistPath := launchdPlistPath()
	res := DaemonStatusResult{Platform: "launchd", UnitFile: plistPath}
	if plistPath == "" {
		res.Detail = i18n.T(i18n.MsgDaemonStatusLaunchdNoPath)
		return res
	}
	if _, err := os.Stat(plistPath); err == nil {
		res.Installed = true
		res.Enabled = true // launchd plist with RunAtLoad implies enabled
	}
	domain := launchdGuiDomain()
	if _, err := runOutput("launchctl", "print", domain+"/"+launchdLabel); err == nil {
		res.Active = true
	}
	if res.Installed {
		res.Detail = i18n.T(i18n.MsgDaemonStatusLaunchdInstalled)
		if res.Active {
			res.Detail += i18n.T(i18n.MsgDaemonStatusLoaded)
		}
	} else {
		res.Detail = i18n.T(i18n.MsgDaemonStatusLaunchdNotInst)
	}
	return res
}

func (s *Service) daemonInstallLaunchd() error {
	plistPath := launchdPlistPath()
	if plistPath == "" {
		return errors.New(i18n.T(i18n.MsgErrDaemonNoPlistPath))
	}

	cmdName := ResolveOpenClawCmd()
	if cmdName == "" {
		return errors.New(i18n.T(i18n.MsgErrDaemonCmdNotFound))
	}
	absCmd, _ := exec.LookPath(cmdName)
	if absCmd == "" {
		absCmd = cmdName
	}

	port := defaultGatewayPort
	bind := "loopback"
	if cfgPath := ResolveConfigPath(); cfgPath != "" {
		if p := configGatewayPort(cfgPath); p != "" {
			port = p
		}
		if b := configGatewayBind(cfgPath); b != "" {
			bind = b
		}
	}

	stateDir := ResolveStateDir()
	logPath := filepath.Join(stateDir, "logs", "gateway.log")
	errPath := filepath.Join(stateDir, "logs", "gateway-err.log")

	content := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>%s</string>
  <key>ProgramArguments</key>
  <array>
    <string>%s</string>
    <string>gateway</string>
    <string>run</string>
    <string>--bind</string>
    <string>%s</string>
    <string>--port</string>
    <string>%s</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>%s</string>
  <key>StandardErrorPath</key>
  <string>%s</string>
</dict>
</plist>
`, launchdLabel, absCmd, bind, port, logPath, errPath)

	os.MkdirAll(filepath.Dir(plistPath), 0755)
	os.MkdirAll(filepath.Dir(logPath), 0755)

	// Backup existing plist
	if _, err := os.Stat(plistPath); err == nil {
		_ = copyFile(plistPath, plistPath+".bak")
	}

	domain := launchdGuiDomain()

	// Unload any existing service before writing new plist
	_ = runCommand("launchctl", "bootout", domain, plistPath)
	_ = runCommand("launchctl", "unload", plistPath)

	if err := os.WriteFile(plistPath, []byte(content), 0644); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrDaemonWritePlist), err)
	}

	// Clear any cached disabled state
	_ = runCommand("launchctl", "enable", domain+"/"+launchdLabel)

	// Bootstrap and kickstart the service
	if err := runCommand("launchctl", "bootstrap", domain, plistPath); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrDaemonBootstrap), err)
	}
	_ = runCommand("launchctl", "kickstart", "-k", domain+"/"+launchdLabel)
	return nil
}

func (s *Service) daemonUninstallLaunchd() error {
	plistPath := launchdPlistPath()
	if plistPath == "" {
		return errors.New(i18n.T(i18n.MsgErrDaemonNoPlistPath))
	}
	domain := launchdGuiDomain()
	_ = runCommand("launchctl", "bootout", domain+"/"+launchdLabel)
	_ = runCommand("launchctl", "unload", plistPath)
	if _, err := os.Stat(plistPath); err == nil {
		// Move to Trash instead of deleting
		home, _ := os.UserHomeDir()
		if home != "" {
			trashDir := filepath.Join(home, ".Trash")
			os.MkdirAll(trashDir, 0755)
			dest := filepath.Join(trashDir, launchdLabel+".plist")
			if err := os.Rename(plistPath, dest); err == nil {
				return nil
			}
		}
		// Fallback: delete directly
		_ = os.Remove(plistPath)
	}
	return nil
}

// ── Windows (Scheduled Task) ──

const windowsTaskName = "OpenClaw Gateway"

func windowsTaskScriptPath() string {
	stateDir := ResolveStateDir()
	if stateDir == "" {
		return ""
	}
	return filepath.Join(stateDir, "gateway.cmd")
}

func windowsTaskLauncherPath() string {
	stateDir := ResolveStateDir()
	if stateDir == "" {
		return ""
	}
	return filepath.Join(stateDir, "gateway-launcher.vbs")
}

func (s *Service) daemonStatusWindows() DaemonStatusResult {
	res := DaemonStatusResult{Platform: "windows"}
	out, err := runOutput("schtasks", "/Query", "/TN", windowsTaskName, "/V", "/FO", "LIST")
	if err != nil {
		res.Detail = i18n.T(i18n.MsgDaemonStatusTaskNotInst)
		return res
	}
	res.Installed = true
	upper := strings.ToUpper(out)
	if strings.Contains(upper, "RUNNING") {
		res.Active = true
	}
	if strings.Contains(upper, "READY") || strings.Contains(upper, "RUNNING") {
		res.Enabled = true
	}
	// Also check if the gateway is actually running (e.g. started manually, not via schtasks)
	if !res.Active && gatewayPortListening() {
		res.Active = true
	}
	res.Detail = i18n.T(i18n.MsgDaemonStatusTaskInstalled)
	if res.Enabled {
		res.Detail += i18n.T(i18n.MsgDaemonStatusEnabled)
	}
	if res.Active {
		res.Detail += i18n.T(i18n.MsgDaemonStatusRunning)
	}
	return res
}

func (s *Service) daemonInstallWindows() error {
	scriptPath := windowsTaskScriptPath()
	if scriptPath == "" {
		return errors.New(i18n.T(i18n.MsgErrDaemonNoStateDir))
	}

	cmdName := ResolveOpenClawCmd()
	if cmdName == "" {
		return errors.New(i18n.T(i18n.MsgErrDaemonCmdNotFound))
	}
	absCmd, _ := exec.LookPath(cmdName)
	if absCmd == "" {
		absCmd = cmdName
	}

	port := defaultGatewayPort
	bind := "loopback"
	if cfgPath := ResolveConfigPath(); cfgPath != "" {
		if p := configGatewayPort(cfgPath); p != "" {
			port = p
		}
		if b := configGatewayBind(cfgPath); b != "" {
			bind = b
		}
	}

	// Backup existing script
	if _, err := os.Stat(scriptPath); err == nil {
		_ = copyFile(scriptPath, scriptPath+".bak")
	}

	// Generate gateway.cmd wrapper script
	script := fmt.Sprintf("@echo off\r\nrem OpenClaw Gateway\r\ncd /d \"%s\"\r\n\"%s\" gateway run --bind %s --port %s\r\n",
		filepath.Dir(absCmd), absCmd, bind, port)

	os.MkdirAll(filepath.Dir(scriptPath), 0755)
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrDaemonWriteScript), err)
	}

	// Generate VBS launcher to run gateway.cmd without a visible console window
	launcherPath := windowsTaskLauncherPath()
	if launcherPath != "" {
		vbs := fmt.Sprintf("Set ws = CreateObject(\"WScript.Shell\")\r\nws.Run \"%s\", 0, False\r\n", scriptPath)
		if err := os.WriteFile(launcherPath, []byte(vbs), 0644); err != nil {
			logger.Gateway.Warn().Err(err).Msg("failed to write VBS launcher, falling back to cmd")
			launcherPath = ""
		}
	}

	// Remove existing task if present
	_ = runCommand("schtasks", "/Delete", "/F", "/TN", windowsTaskName)

	// Determine which script to register: prefer VBS launcher (hidden window) over raw .cmd
	taskTarget := scriptPath
	if launcherPath != "" {
		taskTarget = launcherPath
	}

	// Create scheduled task: run on logon, limited privileges
	if err := runCommand("schtasks", "/Create", "/F",
		"/SC", "ONLOGON",
		"/RL", "LIMITED",
		"/TN", windowsTaskName,
		"/TR", fmt.Sprintf(`"%s"`, taskTarget)); err != nil {
		return fmt.Errorf(i18n.T(i18n.MsgErrDaemonCreateTask), err)
	}

	// Start the task immediately, but only if the gateway is not already running
	if !portListedBySocketTools(port) {
		_ = runCommand("schtasks", "/Run", "/TN", windowsTaskName)
	} else {
		logger.Gateway.Info().Str("port", port).Msg("gateway already running, skipping schtasks /Run")
	}
	return nil
}

func (s *Service) daemonUninstallWindows() error {
	_ = runCommand("schtasks", "/End", "/TN", windowsTaskName)
	_ = runCommand("schtasks", "/Delete", "/F", "/TN", windowsTaskName)
	// Remove task scripts
	if scriptPath := windowsTaskScriptPath(); scriptPath != "" {
		_ = os.Remove(scriptPath)
	}
	if launcherPath := windowsTaskLauncherPath(); launcherPath != "" {
		_ = os.Remove(launcherPath)
	}
	return nil
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, 0644)
}
