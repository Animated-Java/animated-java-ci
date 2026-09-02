<div align=center>
		<img src="https://raw.githubusercontent.com/Animated-Java/animated-java/refs/heads/main/src/assets/icons/animated_java_fancy_icon_centered.svg" alt="Animated Java Icon" width="180px">
	<br/>
</div>

<div align="center">

# Build Animated Java Models

**A GitHub Action that exports [Animated Java](https://animated-java.dev) blueprints headlessly, in CI.**

</div>

---

This action provisions Blockbench, installs Animated Java, and runs every `.ajblueprint`
under a folder through the exporter the same way clicking **Export** does — so a
pull request can verify that every blueprint still builds, and a release can
publish the generated data pack / resource pack.

## Usage

```yaml
- uses: actions/checkout@v4

- uses: Animated-Java/animated-java-ci@v1
  with:
      blueprints-path: models
```

The runner **must be Linux** (`ubuntu-latest`) — Blockbench runs under `xvfb`.

### Inputs

| Input                  | Default               | Description                                                                                                       |
| ---------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `blueprints-path`      | _(required)_          | Folder searched recursively for `.ajblueprint` files.                                                             |
| `version`              | `latest`              | Animated Java version to install: `latest` or a release tag (`v1.10.2`).                                          |
| `plugin-path`          | _(none)_              | Path to a local `animated_java.js` to load instead of downloading a release — for testing an unreleased build.    |
| `blockbench-version`   | `latest`              | Blockbench version to provision: `latest`, `beta`, or an exact `x.y.z`.                                           |
| `fail-fast`            | `true`                | Stop at the first blueprint that fails.                                                                           |
| `check-relative-paths` | `true`                | Fail a blueprint whose pack paths are absolute rather than relative to the blueprint file (see below).            |
| `export-timeout`       | `300`                 | Seconds allowed per blueprint. The first export also downloads that Minecraft version's assets, so keep it ample. |
| `github-token`         | `${{ github.token }}` | Used only for the GitHub API call that resolves the release asset.                                                |

### Outputs

| Output           | Description                                                                         |
| ---------------- | ----------------------------------------------------------------------------------- |
| `exported-count` | Number of blueprints exported successfully.                                         |
| `failed-count`   | Number of blueprints that failed.                                                   |
| `results`        | JSON array: `{ blueprint, path, status, stage, errors, durationMs }` per blueprint. |

The action exits non-zero if any blueprint fails, and writes a summary table to
the job's step summary.

## Blueprints must use relative pack paths

A blueprint stores where its resource pack and data pack are written. When you
save a blueprint from Blockbench on your own machine, those are usually absolute
paths (`C:\Users\you\...\datapacks\pack`). On a runner that folder does not
exist, so the export would fail — or, worse, write somewhere unexpected.

Set the paths in **Blueprint Settings → Export** to a location **relative to the
`.ajblueprint` file**, starting with `./` or `../`:

```
models/
  my_rig.ajblueprint       data pack:      ./datapack
  datapack/                 resource pack:  ./resourcepack
    pack.mcmeta
  resourcepack/
    pack.mcmeta
```

The target folders (with their `pack.mcmeta`) need to exist in the repo — commit
them alongside the blueprint. Before exporting, the action checks each blueprint
and fails it with a clear message if a required pack path is absolute or
missing. Set `check-relative-paths: false` to skip the check (the export will
still fail on its own if the path is unusable).

Plugin-mode blueprints export a single JSON file and are not checked.

## Caching

Blockbench (~120 MB) and each Minecraft version's assets are downloaded on the
first run and kept under `~/.envbench`. Cache that folder so later runs are
fast:

```yaml
- uses: actions/cache@v4
  with:
      path: ~/.envbench
      key: envbench-${{ runner.os }}-blockbench-latest
```

## A complete workflow

See [`examples/build-models.yml`](examples/build-models.yml).

## How it works

```
apt install xvfb
      │
envbench ── provision an isolated Blockbench, launch it under xvfb-run
      │        with the Chrome DevTools Protocol enabled
      │
this action ── attach over CDP, wait for Blockbench to boot
      │         load animated_java.js (release asset or plugin-path)
      │
per blueprint ── load via the Animated Java codec
      │           check resource/data pack paths are relative
      │           AnimatedJava.exportProject(), capturing any failure message
      │           close the project
      │
      └── write outputs + step summary, exit 1 on any failure
```

## Development

```bash
bun install
bun run typecheck
bun test          # unit tests for the path checks + discovery
bun run build     # bundles src/ -> dist/index.cjs (committed; CI verifies it is current)
```

`dist/index.cjs` is committed because a composite action runs straight from the
checked-out repo. Rebuild it whenever `src/` changes.

## License

MIT
