import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import type { AxeMatchers } from 'vitest-axe/matchers';

// Vitest 5 reads custom matcher types only from `vitest.Matchers`, which both
// `Assertion` and `AsymmetricMatchersContaining` extend. The type parameters
// must match Vitest's declaration exactly for the interfaces to merge.
declare module 'vitest' {
	interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
		extends TestingLibraryMatchers<unknown, R>,
			AxeMatchers {}
}
