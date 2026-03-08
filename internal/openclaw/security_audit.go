package openclaw

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

// SecurityAuditFinding represents a single finding from OpenClaw security audit.
type SecurityAuditFinding struct {
	CheckID     string `json:"checkId"`
	Severity    string `json:"severity"` // info | warn | critical
	Title       string `json:"title"`
	Detail      string `json:"detail"`
	Remediation string `json:"remediation,omitempty"`
}

// SecurityAuditSummary contains counts by severity.
type SecurityAuditSummary struct {
	Critical int `json:"critical"`
	Warn     int `json:"warn"`
	Info     int `json:"info"`
}

// SecurityAuditReport is the full result from `openclaw security audit --json`.
type SecurityAuditReport struct {
	Ts       int64                  `json:"ts"`
	Summary  SecurityAuditSummary   `json:"summary"`
	Findings []SecurityAuditFinding `json:"findings"`
}

// --- In-memory cache for security audit results ---
var (
	secAuditMu     sync.RWMutex
	secAuditCache  *SecurityAuditReport
	secAuditCacheT time.Time
	secAuditTTL    = 24 * time.Hour
)

// CachedSecurityAudit returns the cached report if still valid, or nil.
func CachedSecurityAudit() *SecurityAuditReport {
	secAuditMu.RLock()
	defer secAuditMu.RUnlock()
	if secAuditCache != nil && time.Since(secAuditCacheT) < secAuditTTL {
		return secAuditCache
	}
	return nil
}

// SetSecurityAuditCache stores a report in the cache.
func SetSecurityAuditCache(r *SecurityAuditReport) {
	if r == nil {
		return
	}
	secAuditMu.Lock()
	secAuditCache = r
	secAuditCacheT = time.Now()
	secAuditMu.Unlock()
}

// InvalidateSecurityAuditCache clears the cached security audit report,
// forcing the next RunSecurityAuditCached call to re-run the audit.
func InvalidateSecurityAuditCache() {
	secAuditMu.Lock()
	secAuditCache = nil
	secAuditCacheT = time.Time{}
	secAuditMu.Unlock()
}

// RunSecurityAudit calls `openclaw security audit --json` and parses the report.
// The result is automatically cached for subsequent CachedSecurityAudit calls.
func RunSecurityAudit() (*SecurityAuditReport, error) {
	if !IsOpenClawInstalled() {
		return nil, fmt.Errorf("openclaw CLI not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	out, err := RunCLI(ctx, "security", "audit", "--json")
	if err != nil {
		return nil, fmt.Errorf("security audit: %w", err)
	}

	var report SecurityAuditReport
	if err := json.Unmarshal([]byte(out), &report); err != nil {
		return nil, fmt.Errorf("parse security audit json: %w", err)
	}

	SetSecurityAuditCache(&report)
	return &report, nil
}

// RunSecurityAuditWithGW performs security audit using gwclient RPC (remote-first).
// It fetches the config via "config.get" RPC and runs Go-level audit checks.
// Falls back to local CLI if gwclient is unavailable or RPC fails.
func RunSecurityAuditWithGW(client *GWClient) (*SecurityAuditReport, error) {
	// Path 1: gwclient RPC — fetch config and audit in Go
	if client != nil && client.IsConnected() {
		data, err := client.RequestWithTimeout("config.get", map[string]interface{}{}, 15*time.Second)
		if err == nil {
			report := auditConfigJSON(data)
			if report != nil {
				SetSecurityAuditCache(report)
				return report, nil
			}
		}
		// Log and fall through to CLI
	}

	// Path 2: local CLI fallback
	return RunSecurityAudit()
}

// auditConfigJSON performs Go-level security checks on a raw config JSON.
func auditConfigJSON(configRaw json.RawMessage) *SecurityAuditReport {
	var cfg map[string]interface{}
	if err := json.Unmarshal(configRaw, &cfg); err != nil {
		return nil
	}

	var findings []SecurityAuditFinding
	now := time.Now()

	// Check 1: exec tool policy
	if execCfg, ok := cfg["exec"].(map[string]interface{}); ok {
		if policy, ok := execCfg["policy"].(string); ok && policy == "allow" {
			findings = append(findings, SecurityAuditFinding{
				CheckID:     "exec-policy-allow",
				Severity:    "critical",
				Title:       "Exec tool policy set to 'allow'",
				Detail:      "The exec tool is configured to allow all commands without approval. This is a significant security risk.",
				Remediation: "Set exec.policy to 'ask' or 'deny' in your config.",
			})
		}
	}

	// Check 2: channel allowlist missing
	if channelsCfg, ok := cfg["channels"].(map[string]interface{}); ok {
		for chName, chVal := range channelsCfg {
			if chMap, ok := chVal.(map[string]interface{}); ok {
				allowlist, hasAllowlist := chMap["allowlist"]
				if !hasAllowlist {
					findings = append(findings, SecurityAuditFinding{
						CheckID:     fmt.Sprintf("channel-allowlist-%s", chName),
						Severity:    "warn",
						Title:       fmt.Sprintf("Channel '%s' has no allowlist", chName),
						Detail:      "Without an allowlist, any user can interact with this channel.",
						Remediation: fmt.Sprintf("Add an allowlist to channels.%s in your config.", chName),
					})
				} else if arr, ok := allowlist.([]interface{}); ok && len(arr) == 0 {
					findings = append(findings, SecurityAuditFinding{
						CheckID:     fmt.Sprintf("channel-allowlist-empty-%s", chName),
						Severity:    "warn",
						Title:       fmt.Sprintf("Channel '%s' allowlist is empty", chName),
						Detail:      "An empty allowlist blocks all users from this channel.",
						Remediation: fmt.Sprintf("Add authorized users to channels.%s.allowlist.", chName),
					})
				}
			}
		}
	}

	// Check 3: dangerous config flags
	if gateway, ok := cfg["gateway"].(map[string]interface{}); ok {
		if mode, ok := gateway["mode"].(string); ok && mode == "open" {
			findings = append(findings, SecurityAuditFinding{
				CheckID:     "gateway-open-mode",
				Severity:    "critical",
				Title:       "Gateway running in 'open' mode",
				Detail:      "Open mode exposes the gateway without authentication.",
				Remediation: "Set gateway.mode to 'local' or 'remote' with proper authentication.",
			})
		}
	}

	// Check 4: plaintext secrets in config values (basic heuristic)
	checkPlaintextSecrets(cfg, "", &findings)

	// Build summary
	summary := SecurityAuditSummary{}
	for _, f := range findings {
		switch f.Severity {
		case "critical":
			summary.Critical++
		case "warn":
			summary.Warn++
		case "info":
			summary.Info++
		}
	}

	return &SecurityAuditReport{
		Ts:       now.Unix(),
		Summary:  summary,
		Findings: findings,
	}
}

// checkPlaintextSecrets scans config values for potential plaintext secrets.
func checkPlaintextSecrets(obj map[string]interface{}, prefix string, findings *[]SecurityAuditFinding) {
	secretKeyPatterns := []string{"token", "secret", "password", "api_key", "apikey", "key"}
	for k, v := range obj {
		fullKey := k
		if prefix != "" {
			fullKey = prefix + "." + k
		}
		switch val := v.(type) {
		case string:
			if len(val) > 8 {
				lowerK := strings.ToLower(k)
				for _, pat := range secretKeyPatterns {
					if strings.Contains(lowerK, pat) {
						*findings = append(*findings, SecurityAuditFinding{
							CheckID:     fmt.Sprintf("plaintext-secret-%s", fullKey),
							Severity:    "warn",
							Title:       fmt.Sprintf("Potential plaintext secret at '%s'", fullKey),
							Detail:      "This config key appears to contain a secret value stored in plaintext.",
							Remediation: "Use environment variables or a secrets manager for sensitive values.",
						})
						break
					}
				}
			}
		case map[string]interface{}:
			checkPlaintextSecrets(val, fullKey, findings)
		}
	}
}

// RunSecurityAuditCached returns the cached report if valid, otherwise runs the audit.
// If a GWClient is provided, it will attempt remote-first audit.
func RunSecurityAuditCached(client ...*GWClient) (*SecurityAuditReport, error) {
	if cached := CachedSecurityAudit(); cached != nil {
		return cached, nil
	}
	if len(client) > 0 && client[0] != nil {
		return RunSecurityAuditWithGW(client[0])
	}
	return RunSecurityAudit()
}
