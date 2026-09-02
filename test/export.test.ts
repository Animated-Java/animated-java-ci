import { describe, expect, it } from 'bun:test'
import { findPathProblems, isRelativePath } from '../src/export'
import type { RendererBlueprintSettings } from '../src/renderer'

const base: RendererBlueprintSettings = {
	blueprint_id: 'aj:test',
	enable_plugin_mode: false,
	resource_pack: './resourcepack',
	data_pack: './datapack',
	resource_pack_export_mode: 'folder',
	data_pack_export_mode: 'folder',
}

describe('isRelativePath', () => {
	it('accepts ./ ../ and their backslash forms', () => {
		expect(isRelativePath('./rp')).toBe(true)
		expect(isRelativePath('../rp')).toBe(true)
		expect(isRelativePath('.\\rp')).toBe(true)
		expect(isRelativePath('..\\rp')).toBe(true)
	})

	it('rejects absolute and bare paths', () => {
		expect(isRelativePath('C:\\Users\\me\\rp')).toBe(false)
		expect(isRelativePath('/home/me/rp')).toBe(false)
		expect(isRelativePath('resourcepack')).toBe(false)
		expect(isRelativePath('')).toBe(false)
	})
})

describe('findPathProblems', () => {
	it('passes a blueprint with relative folder paths', () => {
		expect(findPathProblems(base)).toEqual([])
	})

	it('flags an absolute resource pack path', () => {
		const problems = findPathProblems({ ...base, resource_pack: 'C:\\Users\\me\\rp' })
		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain('Resource pack path is not relative')
	})

	it('flags an absolute data pack path', () => {
		const problems = findPathProblems({ ...base, data_pack: '/srv/world/datapacks/dp' })
		expect(problems).toHaveLength(1)
		expect(problems[0]).toContain('Data pack path is not relative')
	})

	it('flags both when both are absolute', () => {
		const problems = findPathProblems({
			...base,
			resource_pack: '/a/rp',
			data_pack: '/a/dp',
		})
		expect(problems).toHaveLength(2)
	})

	it('flags a missing path that the export mode requires', () => {
		expect(findPathProblems({ ...base, resource_pack: '' })[0]).toContain(
			'no resource pack path is set'
		)
	})

	it('ignores the resource pack when its export mode is none', () => {
		const problems = findPathProblems({
			...base,
			resource_pack: 'C:\\absolute',
			resource_pack_export_mode: 'none',
		})
		expect(problems).toEqual([])
	})

	it('checks the data pack path for zip mode', () => {
		const problems = findPathProblems({
			...base,
			data_pack: 'C:\\out\\pack.zip',
			data_pack_export_mode: 'zip',
		})
		expect(problems[0]).toContain('Data pack path is not relative')
	})

	it('skips every check in plugin mode', () => {
		const problems = findPathProblems({
			...base,
			enable_plugin_mode: true,
			resource_pack: 'C:\\absolute',
			data_pack: 'C:\\absolute',
		})
		expect(problems).toEqual([])
	})
})
