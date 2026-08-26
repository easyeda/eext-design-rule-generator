import antfu from '@antfu/eslint-config';

export default antfu({
	stylistic: {
		indent: 'tab',
		quotes: 'single',
		semi: true,
	},

	typescript: true,

	ignores: [
		'.hermes/',
		'build/dist/',
		'coverage/',
		'dist/',
		'node_modules/',
		'.eslintcache',
		'debug.log',
		'.api-probe.json',
		'iframe/app.js',
		'iframe/jlc-models.js',
		'iframe/layer-thickness.js',
		'iframe/stackups.js',
		'iframe/stackups.json',
		'.pwr-probe.json',
		'.rule-structure-after.json',
		'.live-current-rules.json',
		'src/**/*.test.ts',
	],

	rules: {
		'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
	},
});
