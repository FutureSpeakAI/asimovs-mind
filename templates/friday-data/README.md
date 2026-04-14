# Friday Data Directory Template

This directory is the template for `~/.friday/` — Agent Friday's persistent user data store.

The setup script copies this structure to `~/.friday/` on first run. Each subdirectory serves a specific system:

```
~/.friday/
├── vault/              Sovereign Vault: AES-256-GCM encrypted file storage
│                       Created by vault_init with master password
├── integrity/          HMAC Integrity: signature manifest and .secret key
│                       Auto-created on first integrity_sign call
├── trust_graph.json    Trust Graph: person-level credibility scores
├── memory.json         Cognitive Memory: 3-tier memory entries + episodes
├── personality.json    Personality Evolution: traits, maturity, sycophancy state
├── epistemic.json      Epistemic Score: interaction records + metrics
├── audio-cache/        Desktop OS: cached TTS audio files
└── vibe-code-logs/     Desktop OS: terminal execution logs
```

All files are created automatically by the respective systems on first use.
You do NOT need to manually create any JSON files.
