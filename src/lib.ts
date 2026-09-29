/**
 * Library entry for other tools that drive Blockbench headlessly
 * (e.g. animated-java-gametest). The action itself starts at `main.ts`.
 */
export { launchBlockbench, type RunningBlockbench } from './blockbench'
export { RendererBridge } from './cdp'
export {
	type ExportOptions,
	type ExportResult,
	type LoadResult,
	type PluginLoadResult,
	type RendererBlueprintSettings,
	rendererExport,
	rendererLoadBlueprint,
	rendererLoadPlugin,
} from './renderer'
