import { readFileSync } from 'node:fs'
import { basename, relative } from 'node:path'
import { type RendererBridge } from './cdp'
import { type ActionConfig } from './config'
import {
	type ExportResult,
	type LoadResult,
	type RendererBlueprintSettings,
	rendererExport,
	rendererLoadBlueprint,
} from './renderer'

export type BlueprintStatus = 'exported' | 'failed' | 'skipped'
export type FailureStage = 'load' | 'path-check' | 'export'

export interface BlueprintResult {
	/** Path relative to `blueprints-path`, for logs and outputs. */
	blueprint: string
	/** Absolute path on disk. */
	path: string
	status: BlueprintStatus
	stage?: FailureStage
	errors: string[]
	durationMs: number
}

const RELATIVE_PREFIX = /^\.\.?[\\/]/

/** Matches Animated Java's own `isRelativePath`: starts with `./`, `../`, `.\` or `..\`. */
export function isRelativePath(path: string): boolean {
	return RELATIVE_PREFIX.test(path)
}

/**
 * Pack-path problems that would make an export write outside the repo - or fail
 * outright - on a runner. Blueprints authored on someone's machine often carry
 * absolute `resource_pack` / `data_pack` paths (`C:\Users\...`); in CI they must
 * be relative to the blueprint file. Mirrors which paths the exporter actually
 * requires for the configured export modes.
 */
export function findPathProblems(settings: RendererBlueprintSettings): string[] {
	if (settings.enable_plugin_mode) return []

	const problems: string[] = []
	const needsResourcePack = settings.resource_pack_export_mode === 'folder'
	const needsDataPack =
		settings.data_pack_export_mode === 'folder' || settings.data_pack_export_mode === 'zip'

	if (needsResourcePack) {
		if (!settings.resource_pack) {
			problems.push('Resource pack export mode is "folder" but no resource pack path is set.')
		} else if (!isRelativePath(settings.resource_pack)) {
			problems.push(
				`Resource pack path is not relative to the blueprint: "${settings.resource_pack}". ` +
					'Use a path like "./resourcepack" or "../resourcepack".'
			)
		}
	}

	if (needsDataPack) {
		if (!settings.data_pack) {
			problems.push(
				`Data pack export mode is "${settings.data_pack_export_mode}" but no data pack path is set.`
			)
		} else if (!isRelativePath(settings.data_pack)) {
			problems.push(
				`Data pack path is not relative to the blueprint: "${settings.data_pack}". ` +
					'Use a path like "./datapack".'
			)
		}
	}

	return problems
}

function dedupe(messages: string[]): string[] {
	return [...new Set(messages.map(m => m.trim()).filter(Boolean))]
}

/** Load one blueprint into the running Blockbench, check its paths, and export it. */
export async function exportBlueprint(
	bridge: RendererBridge,
	blueprintPath: string,
	config: ActionConfig
): Promise<BlueprintResult> {
	const started = Date.now()
	const name = relative(config.blueprintsPath, blueprintPath)
	const base = { blueprint: name, path: blueprintPath }

	let load: LoadResult
	try {
		const content = readFileSync(blueprintPath, 'utf-8')
		load = await bridge.evaluate<LoadResult>(
			rendererLoadBlueprint,
			[blueprintPath, basename(blueprintPath), content],
			config.exportTimeout * 1000
		)
	} catch (e) {
		return {
			...base,
			status: 'failed',
			stage: 'load',
			errors: [`Renderer error while loading: ${(e as Error).message}`],
			durationMs: Date.now() - started,
		}
	}

	if (!load.ok || !load.settings) {
		return {
			...base,
			status: 'failed',
			stage: 'load',
			errors: [load.error ?? 'Blueprint failed to load'],
			durationMs: Date.now() - started,
		}
	}

	if (config.checkRelativePaths) {
		const problems = findPathProblems(load.settings)
		if (problems.length > 0) {
			return {
				...base,
				status: 'failed',
				stage: 'path-check',
				errors: problems,
				durationMs: Date.now() - started,
			}
		}
	}

	let result: ExportResult
	try {
		result = await bridge.evaluate<ExportResult>(
			rendererExport,
			[],
			config.exportTimeout * 1000
		)
	} catch (e) {
		return {
			...base,
			status: 'failed',
			stage: 'export',
			errors: [(e as Error).message],
			durationMs: Date.now() - started,
		}
	}

	if (!result.ok) {
		const errors = dedupe(result.messages)
		return {
			...base,
			status: 'failed',
			stage: 'export',
			errors: errors.length > 0 ? errors : ['Export returned false (no message captured)'],
			durationMs: Date.now() - started,
		}
	}

	return { ...base, status: 'exported', errors: [], durationMs: Date.now() - started }
}
