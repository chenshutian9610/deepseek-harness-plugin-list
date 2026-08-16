---
name: deepseek-harness-plugin-skill
description: Use when creating, changing, debugging, testing, packaging, or publishing a DeepSeek Harness/Cordis plugin, including tools, services, providers, event listeners, capability seams, bundles, profiles, and LLM adapters.
---

# Develop a DeepSeek Harness plugin

Use the bundled, versioned Harness documentation snapshot for the workflow and the target project's installed types or source for exact APIs.

## 1. Locate the docs and target

Let `$SKILL_ROOT` be the directory containing this `SKILL.md`, and `$REF` be `$SKILL_ROOT/references/deepseek-harness`. The bundled plugin-development entry point is `$REF/docs/user/develop/`; it is available without a Harness checkout or network access.

Inspect the target project's `package.json`, source, TypeScript config, tests, installed Harness declarations, and Cordis patch before proposing files. Locate an optional live Harness checkout in the current repository or its parents, `$DEEPSEEK_HARNESS_REPO`, or `~/Documents/Code/deepseek-harness`; call it `$HARNESS` when found. Do not block documented plugin work merely because no checkout exists.

If editing `$HARNESS`, read its root `AGENTS.md`, then every nearer `AGENTS.md`; read its current `docs/architecture.md` before changing `packages/` and `docs/defensive-patterns.md` before lifecycle, concurrency, subprocess, or teardown work.

Read one language of every relevant bundled guide completely: use `*.zh.md` for a Chinese conversation and `*.md` otherwise. Follow bundled links that own the exact API or procedure. For version-sensitive signatures, use the target project's exported TypeScript types, then a live checkout when available, then the bundled snapshot. Note any incompatibility between the target version and the snapshot instead of inventing a compatibility layer.

This phase is complete when you can name the plugin's role, required and provided services, configuration source, load method, target Harness version, and observable verification path.

## 2. Read the branch that matches the task

Start with `$REF/docs/user/develop/basic/index[.zh].md`, then route by work:

| Work | Read completely |
|---|---|
| Configuration | `$REF/docs/user/develop/basic/config[.zh].md` |
| Model-callable tool | `$REF/docs/user/develop/basic/tool[.zh].md`, then `$REF/docs/cookbook/adding-a-tool.md` |
| Lifecycle or cleanup | `$REF/docs/user/develop/framework/index[.zh].md` |
| Service consumer or provider | `$REF/docs/user/develop/framework/service[.zh].md`, then the owning page under `$REF/docs/subsystems/` and the target TypeScript declaration |
| Event listener or producer | `$REF/docs/user/develop/framework/events[.zh].md`, then the owning subsystem page and `$REF/docs/event-producer-consumer.md` |
| Replaceable capability | `$REF/docs/user/develop/practice/index[.zh].md`, `$REF/docs/capability-seams.md`, and `$REF/docs/cookbook/adding-a-package.md` for in-tree packages |
| LLM provider | `$REF/docs/user/develop/practice/llm-adapter[.zh].md` and `$REF/docs/cookbook/adding-an-llm-adapter.md`; compare the shipped adapters when source is available |
| Installation or distribution | `$REF/docs/user/develop/basic/publish[.zh].md` and `$REF/apps/cli/reference/README.md` |

Read only the branches the task reaches. The bracket notation means the `.zh.md` file for Chinese or the `.md` file otherwise. When a bundled guide and the target's exported type differ, the target type wins; inspect nearby callers before coding.

## 3. Choose the smallest plugin form

Use a function plugin by default. Use a `Service` subclass when the plugin provides a named service. Keep one package unless Service Definition, Service Provider, and Consumer genuinely need independent replacement or evolution; a simple tool is one plugin.

Use a local `--patch` overlay for development. Add a bundle only when users must install or enable a configuration layer. Let `dsh plugin` manage profiles rather than hand-writing profile manifests.

Before implementation, state the minimum design:

- plugin exports and required `inject` services;
- configuration fields and schema defaults;
- registrations and the Fiber that owns them;
- explicit resources and their disposer;
- Cordis rows needed to load the plugin;
- one behavior check that exercises the assembled plugin.

This phase is complete when each dependency, registration, and resource has one clear owner and no speculative package or abstraction remains.

## 4. Implement through extension points

Follow these invariants while using the relevant guide for exact syntax:

- Declare every required service in `inject`; query truly optional services at the use site.
- Export a Schemastery `Config` schema with the `Config` type. Put defaults and self-contained validation in the schema. Make deployment-varying values configurable.
- Register listeners, tools, adapters, child plugins, and other contributions through `ctx`; put manually owned resources in `ctx.effect()` and return a disposer. Keep order-dependent async cleanup in one disposer and await it serially.
- Use typed declaration merging for new Context services and events. A waterfall listener calls `next()` unless interception is the requested behavior.
- For a tool, define parameters, canonical output, rendering, and UI render intent before execution code. Test through the real tool registry and assembled app path.
- For an LLM adapter, implement the current exported request and stream protocols exactly, propagate cancellation, attribution headers, stable `LlmError` codes, and every supported option. Reject unsupported explicit options instead of dropping them.
- Add model-visible information through a documented extension point. If it must survive reload or reconstruct a model request, record it in the session log.
- Extend the agent loop only when no documented extension point can express the behavior; when editing `$HARNESS`, update `docs/architecture.md` as required by repository instructions.

Keep imports ESM-compatible and reuse the nearest existing package pattern. Do not add compatibility layers for APIs absent from the current checkout.

## 5. Compose and prove it

Use the target project's existing scripts and the narrowest check that covers the change. At minimum:

1. Typecheck the affected project or package.
2. Load the plugin through its real Cordis patch or bundle.
3. Inspect the composition with `dsh --profile <profile> --dump-config` or the equivalent source command.
4. Boot the actual target surface and exercise the observable behavior.
5. For explicit resources, unload or hot-replace the plugin and verify cleanup reaches quiescence.
6. For a distributable bundle, build or pack it, install that artifact into a disposable profile, and verify the installed entry points and layer.

When editing `$HARNESS`, follow its testing and documentation rules, including focused unit/e2e/snapshot evidence, package README/JSDoc updates, Agent Notes for non-trivial changes, and the repository's pre-push workflow. Never print credentials; real-provider checks may self-skip when no key is available.

Finish only when the implementation, Cordis composition, cleanup behavior, and user-observable path all pass. Report the exact commands run and any check not run.
