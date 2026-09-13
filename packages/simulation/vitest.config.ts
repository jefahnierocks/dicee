import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.ts'],
		exclude: ['dist/**', 'results/**', 'test-output/**'],
		environment: 'node',
		globals: true,
	},
});
