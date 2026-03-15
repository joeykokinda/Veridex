/**
 * Veridex blocking layer
 * Inspects action payloads BEFORE execution and blocks dangerous patterns.
 * Returns null if allowed, or { reason, riskLevel } if blocked.
 */

// Per-agent action rate tracking for loop detection
const actionWindows = new Map(); // agentId -> [timestamps]

// Dangerous shell command patterns
const DANGEROUS_SHELL_PATTERNS = [
  { pattern: /rm\s+-rf/i,          label: "Recursive delete (rm -rf)" },
  { pattern: /\/etc\/passwd/,       label: "Reading /etc/passwd" },
  { pattern: /\/etc\/shadow/,       label: "Reading /etc/shadow" },
  { pattern: /\/etc\/hosts/,        label: "Modifying /etc/hosts" },
  { pattern: /curl\s+.*\|\s*bash/i, label: "Remote code execution (curl|bash)" },
  { pattern: /wget\s+.*\|\s*sh/i,   label: "Remote code execution (wget|sh)" },
  { pattern: /base64\s+-d.*\|/i,    label: "Encoded payload execution" },
  { pattern: /\/root\//,            label: "Accessing /root directory" },
  { pattern: /python.*-c.*exec/i,   label: "Python arbitrary code execution" },
  { pattern: /chmod\s+777/i,        label: "Dangerous permissions change" },
  { pattern: />\s*\/dev\//,         label: "Writing to device file" },
  { pattern: /dd\s+if=/i,           label: "Raw disk operation (dd)" },
  { pattern: /mkfs/i,               label: "Filesystem format command" },
];

// Secret / credential leak patterns in params or results
const SECRET_PATTERNS = [
  { pattern: /sk_live_[a-zA-Z0-9]+/,     label: "Stripe live secret key" },
  { pattern: /sk_test_[a-zA-Z0-9]+/,     label: "Stripe test secret key" },
  { pattern: /AKIA[0-9A-Z]{16}/,         label: "AWS access key" },
  { pattern: /-----BEGIN.*PRIVATE KEY/,  label: "Private key material" },
  { pattern: /Bearer\s+[a-zA-Z0-9_-]{20,}/, label: "Bearer token" },
  { pattern: /password\s*[:=]\s*\S{8,}/i,  label: "Password in plaintext" },
];

// Known malicious or C2 domain patterns
const BLACKLISTED_DOMAINS = [
  "evil.com", "malware.io", "c2server.net"
];

/**
 * Check if an action should be blocked.
 * @param {string} agentId
 * @param {string} action - action type (shell_exec, file_access, api_call, etc.)
 * @param {string} tool - tool name
 * @param {object} params - sanitized parameters
 * @param {string[]} customPolicies - agent-specific policy values [{ type, value }]
 * @returns {{ reason: string, riskLevel: string } | null}
 */
function checkBlocking(agentId, action, tool, params, customPolicies = []) {
  const paramsStr = JSON.stringify(params || {}).toLowerCase();

  // 1. Shell command dangerous pattern check
  if (action === "shell_exec" || tool === "bash" || tool === "shell" || tool === "exec") {
    const cmd = (params?.command || params?.cmd || paramsStr);
    for (const { pattern, label } of DANGEROUS_SHELL_PATTERNS) {
      if (pattern.test(cmd)) {
        return { reason: `Dangerous shell command blocked: ${label}`, riskLevel: "blocked" };
      }
    }
  }

  // 2. Secret leak detection in any params
  for (const { pattern, label } of SECRET_PATTERNS) {
    if (pattern.test(paramsStr)) {
      return { reason: `Secret/credential detected in params: ${label}`, riskLevel: "blocked" };
    }
  }

  // 3. API call domain blacklist
  if (action === "api_call" || tool === "http_request" || tool === "fetch") {
    const url = params?.url || params?.endpoint || "";
    for (const domain of BLACKLISTED_DOMAINS) {
      if (url.includes(domain)) {
        return { reason: `Blacklisted domain: ${domain}`, riskLevel: "blocked" };
      }
    }
  }

  // 4. Custom agent policies
  for (const policy of customPolicies) {
    if (policy.type === "blacklist_domain") {
      const url = params?.url || params?.endpoint || "";
      if (url.includes(policy.value)) {
        return { reason: `Custom policy: blocked domain ${policy.value}`, riskLevel: "blocked" };
      }
    }
    if (policy.type === "blacklist_command") {
      const cmd = params?.command || params?.cmd || "";
      if (cmd.includes(policy.value)) {
        return { reason: `Custom policy: blocked command pattern "${policy.value}"`, riskLevel: "blocked" };
      }
    }
    if (policy.type === "block_file_path") {
      const filePath = params?.path || params?.file || "";
      if (filePath.includes(policy.value)) {
        return { reason: `Custom policy: blocked file path "${policy.value}"`, riskLevel: "blocked" };
      }
    }
  }

  // 5. Loop detection — same action 20+ times in 60 seconds
  const windowKey = `${agentId}:${action}:${tool}`;
  if (!actionWindows.has(windowKey)) actionWindows.set(windowKey, []);
  const window = actionWindows.get(windowKey);
  const now = Date.now();
  const pruned = window.filter(t => now - t < 60000);
  pruned.push(now);
  actionWindows.set(windowKey, pruned);

  if (pruned.length >= 20) {
    return { reason: `Loop detection: action "${action}/${tool}" repeated ${pruned.length} times in 60s`, riskLevel: "blocked" };
  }

  return null; // allowed
}

/**
 * Compute risk level for an allowed action (not blocked).
 */
function assessRisk(action, tool, params) {
  const paramsStr = JSON.stringify(params || {}).toLowerCase();

  // High risk: file system access outside typical dirs, large HBAR sends
  if (action === "file_access" || action === "file_write") {
    const p = params?.path || "";
    if (p.startsWith("/etc") || p.startsWith("/sys") || p.startsWith("/proc")) {
      return "high";
    }
  }
  if (action === "hbar_send") {
    const amount = parseFloat(params?.amount || 0);
    if (amount > 100) return "high";
    if (amount > 10)  return "medium";
  }
  if (action === "shell_exec") return "medium";
  if (action === "api_call" && paramsStr.includes("external")) return "medium";

  return "low";
}

/**
 * Decode an action log entry into a plain-English description.
 */
function decodeAction(log) {
  const params = log.params || {};
  const templates = {
    web_search:  (p) => `Searched web for "${p.query || p.q || "..."}"`,
    file_read:   (p) => `Read file: ${p.path || p.file || "unknown"}`,
    file_write:  (p) => `Wrote to file: ${p.path || p.file || "unknown"}`,
    file_access: (p) => `Accessed file: ${p.path || p.file || "unknown"}`,
    shell_exec:  (p) => `Ran command: ${(p.command || p.cmd || "").slice(0, 60)}`,
    bash:        (p) => `Ran command: ${(p.command || p.cmd || "").slice(0, 60)}`,
    api_call:    (p) => `Called API: ${(p.url || p.endpoint || "unknown").replace(/^https?:\/\//, "").slice(0, 50)}`,
    http_request:(p) => `HTTP ${p.method || "GET"}: ${(p.url || "unknown").replace(/^https?:\/\//, "").slice(0, 50)}`,
    hbar_send:   (p) => `Sent ${p.amount || "?"} HBAR to ${(p.recipient || p.to || "unknown").slice(0, 20)}`,
    email_send:  (p) => `Sent email to ${p.to || "unknown"}`,
    tool_call:   (p) => `Called tool: ${log.tool || "unknown"}`,
  };

  const prefix = log.result === "blocked" ? "⛔ BLOCKED: " : "";
  const decoder = templates[log.action] || templates[log.tool];
  if (decoder) {
    try { return prefix + decoder(params); } catch { /* fall through */ }
  }

  return prefix + `${log.action || log.tool || "unknown"}: ${log.tool || ""}`.trim();
}

module.exports = { checkBlocking, assessRisk, decodeAction };
