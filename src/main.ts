import { existsSync } from 'node:fs'
import { relative } from 'node:path'
import { launchBlockbench } from './blockbench'
import { findBlueprints } from './blueprints'
import { RendererBridge } from './cdp'
import { loadConfig } from './config'
import { type BlueprintResult, exportBlueprint } from './export'
import * as log from './log'
import { resolvePlugin } from './plugin'
import { type PluginLoadResult, rendererLoadPlugin } from './renderer'

const BLOCKBENCH_READY = '!!(window.Blockbench && window.Blockbench.setup_successful === true)'
const AJ_PLUGIN_ID = 'animated_java'

async function run(): Promise<void> {
	const config = loadConfig()

	if (!existsSync(config.blueprintsPath)) {
		throw new Error(`blueprints-path does not exist: ${config.blueprintsPath}`)
	}

	const blueprints = findBlueprints(config.blueprintsPath)
	log.info(`Found ${blueprints.length} blueprint(s) under ${config.blueprintsPath}`)
	if (blueprints.length === 0) {
		throw new Error(
			`No .ajblueprint files found under ${config.blueprintsPath} - check the blueprints-path input`
		)
	}

	const plugin = await resolvePlugin(config)
	log.info(`Animated Java plugin: ${plugin.source}`)

	const blockbench = await launchBlockbench(config.blockbenchVersion)
	let bridge: RendererBridge | undefined
	const results: BlueprintResult[] = []

	try {
		bridge = await RendererBridge.attach(blockbench.debugPort, 60_000)
		await bridge.waitFor(BLOCKBENCH_READY, 120_000)
		log.info('Blockbench is ready')

		const loaded = await bridge.evaluate<PluginLoadResult>(rendererLoadPlugin, [
			plugin.path,
			AJ_PLUGIN_ID,
		])
		if (!loaded.ok) {
			throw new Error(`Failed to load Animated Java: ${loaded.error ?? 'unknown error'}`)
		}
		log.info(`Loaded Animated Java${loaded.version ? ` ${loaded.version}` : ''}`)

		for (let i = 0; i < blueprints.length; i++) {
			const blueprintPath = blueprints[i]!
			const name = relative(config.blueprintsPath, blueprintPath)

			log.group(`Blueprint: ${name}`)
			const result = await exportBlueprint(bridge, blueprintPath, config)
			for (const message of result.errors) log.info(message)
			log.info(
				result.status === 'exported'
					? `exported in ${(result.durationMs / 1000).toFixed(1)}s`
					: `${result.stage} check failed`
			)
			log.endGroup()

			results.push(result)

			if (result.status === 'failed') {
				log.error(`${name}: ${result.errors[0] ?? 'export failed'}`)
				if (config.failFast) {
					for (const skipped of blueprints.slice(i + 1)) {
						results.push({
							blueprint: relative(config.blueprintsPath, skipped),
							path: skipped,
							status: 'skipped',
							errors: ['Skipped after an earlier failure (fail-fast)'],
							durationMs: 0,
						})
					}
					break
				}
			}
		}
	} catch (e) {
		if (blockbench.readLog().trim()) {
			log.info('--- Blockbench output ---')
			log.info(blockbench.readLog())
		}
		throw e
	} finally {
		bridge?.close()
		await blockbench.kill()
	}

	finish(results)
}

function finish(results: BlueprintResult[]): void {
	const exported = results.filter(r => r.status === 'exported')
	const failed = results.filter(r => r.status === 'failed')
	const skipped = results.filter(r => r.status === 'skipped')

	log.setOutput('exported-count', String(exported.length))
	log.setOutput('failed-count', String(failed.length))
	log.setOutput('results', JSON.stringify(results))

	writeSummary(results)

	log.info('')
	log.info(
		`Done: ${exported.length} exported, ${failed.length} failed` +
			(skipped.length ? `, ${skipped.length} skipped` : '')
	)

	if (failed.length > 0) {
		process.exitCode = 1
	}
}

function writeSummary(results: BlueprintResult[]): void {
	const icon: Record<BlueprintResult['status'], string> = {
		exported: 'exported',
		failed: 'FAILED',
		skipped: 'skipped',
	}
	const rows = results
		.map(r => {
			const detail = r.errors[0] ? r.errors[0].replace(/\r?\n/g, ' ').slice(0, 200) : ''
			return `| \`${r.blueprint}\` | ${icon[r.status]} | ${detail} |`
		})
		.join('\n')

	log.appendSummary(
		`### Animated Java build\n\n` +
			`| Blueprint | Result | Detail |\n| --- | --- | --- |\n${rows}`
	)
}

run().catch((e: Error) => {
	log.error(e.message)
	if (e.stack) log.info(e.stack)
	process.exitCode = 1
})
