# Change Log

All notable changes to the "r-pixi-venv" extension will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.4] — 2026-02-26

### Fixed
- Render and Preview commands now run Quarto with the **workspace root** as the
  working directory instead of the directory containing the `.qmd` file.
  Previously, running from `analysis/` caused `source("utils/helpers.R")` in the
  R setup chunk to fail with `cannot open the connection` because the relative
  path resolved to `analysis/utils/helpers.R` rather than `<project_root>/utils/helpers.R`.
  `knitr::opts_knit$set(root.dir = ...)` only takes effect for chunks *after* the
  setup chunk, so Quarto itself must already be running from the project root.

## [0.1.3] — 2026-02-26

### Added
- Setup now writes minimal `conda` and `activate` shims into the pixi env's
  `bin/` directory (non-Windows only). reticulate 1.45 detects `conda-meta/` in
  the pixi prefix and tries to activate the env via `conda run`; because pixi
  ships no `conda` binary, activation fails silently and reticulate falls back to
  the system Python — which has none of the project packages. The shims satisfy
  reticulate's `conda_run2_nix` call without requiring a real conda installation.
  Existing shims are overwritten on each setup run so they stay correct after
  `pixi install` rebuilds the env.

## [0.1.2] — 2026-02-26

### Fixed
- `r.rpath` is now set to the direct pixi R binary (`prefix/bin/R`) instead of the
  shell-script wrapper. The Quarto VS Code extension reads `r.rpath` and passes it as
  `QUARTO_R`; Quarto rejects shell scripts there and silently falls back to the system
  R, which does not have the pixi packages installed (manifested as
  `Error: object 'reticulate' not found` when running interactive chunks).
- `r.rterm` continues to use the `pixi run` wrapper so the interactive R terminal
  still gets the full pixi-activated environment.

### Added
- Setup now creates a `.pixi-activate.sh` project activation hook at the workspace
  root if one does not already exist, eliminating the
  `WARN Could not find activation scripts` noise on every `pixi run` invocation.

## [0.1.1] — 2026-02-26

### Fixed
- Hotfix: manifest path discovery now correctly falls back to `pyproject.toml` when
  no `pixi.toml` is present at the workspace root.

## [0.1.0] — 2026-02-26

- Initial release
