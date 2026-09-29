import { describe, expect, it } from 'bun:test'
import * as lib from '../src/lib'

// animated-java-gametest imports these; a rename here breaks it silently otherwise.
describe('lib', () => {
	it('exports the Blockbench driver', () => {
		expect(typeof lib.launchBlockbench).toBe('function')
		expect(typeof lib.RendererBridge.attach).toBe('function')
		expect(typeof lib.rendererLoadPlugin).toBe('function')
		expect(typeof lib.rendererLoadBlueprint).toBe('function')
		expect(typeof lib.rendererExport).toBe('function')
	})
})
