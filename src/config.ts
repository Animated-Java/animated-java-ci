import { isAbsolute, resolve } from 'node:path'

export interface ActionConfig {
	/** Absolute path to the folder searched recursively for `.ajblueprint` files. */
	blueprintsPath: string
	/** Animated Java version to install: `latest` or a release tag (`v1.10.2` / `1.10.2`). */
	version: string
	/** Absolute path to a local `animated_java.js`, used instead of downloading a release. */
	pluginPath: string | undefined
	/** Blockbench version envbench provisions: `latest`, `beta`, or `x.y.z`. */
	blockbenchVersion: string
	/** Stop at the first blueprint that fails. */
	failFast: boolean
	/** Fail a blueprint whose pack paths are absolute instead of relative to the blueprint file. */
	checkRelativePaths: boolean
	/** Seconds allowed for a single blueprint's export (the first run also downloads MC assets). */
	exportTimeout: number
	/** GitHub token for release-asset API calls (raises the anonymous rate limit). */
	githubToken: string | undefined
}

function required(name: string): string {
	const value = process.env[name]
	if (!value || value.trim() === '') {
		throw new Error(`Missing required input (${envToInput(name)})`)
	}
	return value.trim()
}

function envToInput(name: string): string {
	return name
		.replace(/^INPUT_/, '')
		.toLowerCase()
		.replace(/_/g, '-')
}

function bool(name: string, fallback: boolean): boolean {
	const value = process.env[name]?.trim().toLowerCase()
	if (!value) return fallback
	if (['true', '1', 'yes', 'on'].includes(value)) return true
	if (['false', '0', 'no', 'off'].includes(value)) return false
	throw new Error(`Input ${envToInput(name)} must be a boolean, got "${value}"`)
}

function int(name: string, fallback: number): number {
	const value = process.env[name]?.trim()
	if (!value) return fallback
	const parsed = Number(value)
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Input ${envToInput(name)} must be a positive number, got "${value}"`)
	}
	return parsed
}

export function loadConfig(cwd = process.cwd()): ActionConfig {
	const blueprintsPath = required('INPUT_BLUEPRINTS_PATH')
	const pluginPath = process.env.INPUT_PLUGIN_PATH?.trim()

	return {
		blueprintsPath: isAbsolute(blueprintsPath) ? blueprintsPath : resolve(cwd, blueprintsPath),
		version: process.env.INPUT_VERSION?.trim() || 'latest',
		pluginPath: pluginPath
			? isAbsolute(pluginPath)
				? pluginPath
				: resolve(cwd, pluginPath)
			: undefined,
		blockbenchVersion: process.env.INPUT_BLOCKBENCH_VERSION?.trim() || 'latest',
		failFast: bool('INPUT_FAIL_FAST', true),
		checkRelativePaths: bool('INPUT_CHECK_RELATIVE_PATHS', true),
		exportTimeout: int('INPUT_EXPORT_TIMEOUT', 300),
		githubToken: process.env.GITHUB_TOKEN?.trim() || undefined,
	}
}
