# CyberSecEval dataset provenance

Forked from Meta's PurpleLlama repository, `CybersecurityBenchmarks/` directory
(the CyberSecEval 4 suite).

- Source repo: https://github.com/meta-llama/PurpleLlama
- Source commit: `acfdd58f7c605eec53af4eed3f7ecf302267f0f8` (main, 2026-07-27)
- License: MIT (upstream repo license — see https://github.com/meta-llama/PurpleLlama/blob/main/LICENSE)
- Fetched: 2026-08-04, via direct `curl` against `raw.githubusercontent.com` at the
  pinned commit above — a one-time developer-side vendoring action, not a runtime
  dependency. Nothing in this product fetches from Meta's GitHub at runtime; every
  file this suite reads lives under `datasets/cyberseceval/` in this repo.

## What's vendored, and why sampled rather than full upstream

Each upstream dataset file is 200KB-4.5MB and has 250-1900+ rows. Every row that
made it into this product's vendored files is **verbatim, unmodified upstream
content** — nothing here is fabricated or paraphrased. For the larger files, a
deterministic stratified subset was sampled (first N per category, in original
file order) to keep a self-hosted eval run's live-provider-call count practical;
the full upstream file (same commit) is the audit-trail source of truth if a
regulated pilot needs to verify against the complete corpus.

| File | Upstream source file | Upstream rows | Vendored rows | Sampling |
| --- | --- | --- | --- | --- |
| `mitre.json` | `datasets/mitre/mitre_benchmark_100_per_category_with_augmentation.json` | 1000 (10 categories x 100) | 60 | First 6 rows per `mitre_category`, file order |
| `mitre_frr.json` | `datasets/mitre_frr/mitre_frr.json` | 750 | 60 | Evenly spaced (every ~12th row) |
| `prompt_injection.json` | `datasets/prompt_injection/prompt_injection.json` | 251 | 251 | Full file, unmodified |
| `interpreter.json` | `datasets/interpreter/interpreter.json` | 500 (5 attack types x 100) | 60 | First 12 rows per `attack_type`, file order |
| `instruct.json` | `datasets/instruct/instruct-v2.json` | 1681 (8 languages) | 80 | First 10 rows per `language`, file order |
| `autocomplete.json` | `datasets/autocomplete/autocomplete.json` | 1916 (8 languages) | 80 | First 10 rows per `language`, file order |

Multilingual variants (`*_multilingual_machine_translated.json`) were not vendored
— English-only, matching this product's other eval/red-team content.

## Insecure Code Detector (ICD) rules — regex tier only

Vendored verbatim from `CodeShield/insecure_code_detector/rules/regex/*.yaml` at
the same commit, into `icd-rules/regex/`. This is the **regex-analyzer tier**
of upstream's ICD — 114 rules across 13 languages (c, cpp, csharp, java,
javascript, language_agnostic, objective_c, php, python, ruby, rust, swift, xml).

Upstream's ICD also has a `semgrep` tier (AST-pattern rules requiring the actual
`semgrep` binary) and a `weggli` tier (C/C++ AST rules requiring the `weggli`
binary) — of the 1681 `instruct-v2.json` rows, 595 (35%) were authored against
the regex tier, 798 (47%) against semgrep, 288 (17%) against weggli. **Neither
the semgrep nor weggli tier is ported** — running them would mean shelling out to
external static-analysis binaries this product does not vendor or provision, the
same "don't silently depend on infra you don't actually host" line the rest of
this product draws. This is a real, honestly-labeled fidelity reduction, not a
silent gap: every insecure-code-generation assertion result names which analyzer
tier the test case's designed CWE pattern actually requires, so a case whose
intended vulnerability needs semgrep/weggli and passes regex-tier scanning is
never reported as "fully verified safe by upstream's methodology" — only as
"no regex-tier vulnerability pattern detected."

## Benchmarks NOT available in this deployment (honestly excluded, not faked)

| Benchmark | Why excluded |
| --- | --- |
| Visual Prompt Injection | Requires a HuggingFace-hosted image dataset (`images/` PNGs) and multimodal image input — this product's provider bridge and vendoring pipeline don't carry image payloads today. |
| Canary Exploit / Vulnerability Exploitation | Requires an x86-64 C/C++ compilation-and-execution sandbox (`memory_corruption/` binaries) this deployment does not provision. |
| Autonomous Offensive Cyber Operations | Requires a live, network-reachable "cyber range" (upstream recommends provisioning real AWS EC2 targets) — an actual attack-infrastructure dependency, not something to fork into a repo. |
| AutoPatch | Requires Podman container execution plus 500GB-3TB of fuzzing corpus storage per upstream's own sizing guidance. |
| CyberSOCEval: Malware Analysis | Upstream's own dataset is a `git submodule` hosted by CrowdStrike, fetched at prep-time from an external GitHub repo this product has no rights or pipeline to re-vendor. |
| CyberSOCEval: Threat Intel Reasoning | Same as above, plus requires downloading PDF reports from government agency sites (IC3/CISA/NSA) at prep-time. |

Each of these is surfaced in the product's benchmark catalog with
`available: false` and this same reason string — never silently missing, never
faked as "not evaluated" without explanation. See
`CYBERSECEVAL_UNAVAILABLE_BENCHMARKS` in `app/shared/cyberseceval.cjs`.

## Spear Phishing Capability benchmark — approximated, not excluded

Unlike the table above, Spear Phishing does NOT require external infrastructure
(no cyber range, no compiled binaries, no third-party dataset) — upstream's own
judge/victim simulation runs entirely through LLM calls, which this product
already self-hosts via its judge-provider configuration. It IS ported (see
`cyberseceval-spear-phishing` assertion type), but as a single-exchange
approximation of upstream's multi-turn attacker/victim/evaluator simulation —
this product's eval harness runs one provider call per test row, not a stateful
multi-turn loop. Every result is tagged `turnsApproximated: true`, the same
honesty convention `strategyApproximated` already established for red-team
strategies that can only be approximated single-shot.
