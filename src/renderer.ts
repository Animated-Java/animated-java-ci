/**
 * Functions in this file do not run here - they are serialised with
 * `Function.prototype.toString()` and evaluated inside the Blockbench renderer
 * by {@link RendererBridge.evaluate}. That means:
 *
 *   - they may only use their arguments and renderer globals, never module scope
 *   - arguments and return values must be JSON-serialisable
 *   - the file's bytes are read in Node and passed in, since Blockbench's
 *     renderer does not expose `require`
 *
 * Keep them plain (no TS-only syntax that needs downlevel helpers).
 */

export interface LoadResult {
	ok: boolean
	error?: string
	savePath?: string | null
	settings?: RendererBlueprintSettings
}

export interface RendererBlueprintSettings {
	blueprint_id: string | null
	enable_plugin_mode: boolean
	resource_pack: string
	data_pack: string
	resource_pack_export_mode: string
	data_pack_export_mode: string
}

export interface ExportResult {
	ok: boolean
	messages: string[]
}

export interface PluginLoadResult {
	ok: boolean
	error?: string | null
	version?: string | null
}

export async function rendererLoadPlugin(
	pluginFilePath: string,
	expectedId: string
): Promise<PluginLoadResult> {
	const g = globalThis as any
	const Plugin = g.Plugin
	const Plugins = g.Plugins
	if (!Plugin || !Plugins) return { ok: false, error: 'Blockbench Plugin API is unavailable' }

	for (const pl of (Plugins.all || []).filter((x: any) => x.id === expectedId)) {
		try {
			pl.unload && pl.unload()
		} catch (e) {
			/* ignore a throwing onunload */
		}
		Plugins.all.remove && Plugins.all.remove(pl)
		if (Plugins.registered) delete Plugins.registered[expectedId]
	}

	try {
		await new Plugin().loadFromFile(
			{ path: pluginFilePath, name: pluginFilePath, content: '' },
			false
		)
	} catch (e: any) {
		return { ok: false, error: (e && (e.stack || e.message)) || String(e) }
	}

	// Don't leave the plugin installed in the persistent envbench environment.
	const installed =
		Plugins.installed && Plugins.installed.find
			? Plugins.installed.find((x: any) => x.id === expectedId)
			: undefined
	if (installed) {
		Plugins.installed.remove && Plugins.installed.remove(installed)
		try {
			g.StateMemory && g.StateMemory.save && g.StateMemory.save('installed_plugins')
		} catch (e) {
			/* best effort */
		}
	}

	const loaded = (Plugins.all || []).find((x: any) => x.id === expectedId)
	return {
		ok: !!loaded,
		error: loaded ? null : `Plugin "${expectedId}" did not register after loading`,
		version: loaded ? loaded.version || null : null,
	}
}

export async function rendererLoadBlueprint(
	blueprintPath: string,
	fileName: string,
	content: string
): Promise<LoadResult> {
	const g = globalThis as any
	const aj = (g.window && g.window.AnimatedJava) || g.AnimatedJava
	if (!aj) return { ok: false, error: 'Animated Java plugin is not loaded' }

	let codec: any
	try {
		codec = aj.BLUEPRINT_CODEC.get()
	} catch (e) {
		codec = null
	}
	if (!codec || typeof codec.load !== 'function') {
		return { ok: false, error: 'Could not access the Animated Java blueprint codec' }
	}

	// Discard any project left open by a previous blueprint.
	try {
		if (g.Project && typeof g.Project.close === 'function') await g.Project.close(true)
	} catch (e) {
		/* nothing to close */
	}

	let model: any
	try {
		model = JSON.parse(content)
	} catch (e: any) {
		return { ok: false, error: 'File is not valid JSON: ' + ((e && e.message) || String(e)) }
	}

	try {
		codec.load(model, { path: blueprintPath, name: fileName, content })
	} catch (e: any) {
		return {
			ok: false,
			error: 'Blueprint failed to load: ' + ((e && (e.stack || e.message)) || String(e)),
		}
	}

	const project = g.Project
	if (!project || !project.format || project.format.id !== 'animated-java:format/blueprint') {
		return { ok: false, error: 'File did not open as an Animated Java blueprint' }
	}

	const s = project.animated_java || {}
	return {
		ok: true,
		savePath: project.save_path || null,
		settings: {
			blueprint_id: s.blueprint_id || null,
			enable_plugin_mode: !!s.enable_plugin_mode,
			resource_pack: s.resource_pack || '',
			data_pack: s.data_pack || '',
			resource_pack_export_mode: s.resource_pack_export_mode || 'folder',
			data_pack_export_mode: s.data_pack_export_mode || 'folder',
		},
	}
}

export async function rendererExport(): Promise<ExportResult> {
	const g = globalThis as any
	const aj = (g.window && g.window.AnimatedJava) || g.AnimatedJava
	if (!aj || typeof aj.exportProject !== 'function') {
		return { ok: false, messages: ['Animated Java exportProject() is unavailable'] }
	}
	const B = g.Blockbench
	const messages: string[] = []

	// The exporter reports failures through message boxes / the unexpected-error
	// dialog and `console.error`. Capture those so a failed export has a reason.
	const originalMessageBox = B.showMessageBox
	const originalConsoleError = g.console.error
	B.showMessageBox = function (opts: any) {
		const text =
			typeof opts === 'string'
				? opts
				: [opts && opts.title, opts && opts.message].filter(Boolean).join(': ')
		if (text) messages.push(text)
		return 0
	}
	g.console.error = function () {
		const args = Array.prototype.slice.call(arguments)
		messages.push(args.map((x: any) => (x && x.stack ? x.stack : String(x))).join(' '))
		try {
			originalConsoleError.apply(g.console, args)
		} catch (e) {
			/* ignore */
		}
	}

	let ok = false
	let thrown: string | null = null
	try {
		ok = await aj.exportProject()
	} catch (e: any) {
		thrown = (e && (e.stack || e.message)) || String(e)
	} finally {
		B.showMessageBox = originalMessageBox
		g.console.error = originalConsoleError
	}

	return { ok: !!ok, messages: thrown ? [thrown].concat(messages) : messages }
}
