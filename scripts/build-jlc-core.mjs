import { build } from 'esbuild';

await build({ entryPoints: ['src/core/jlc-offline.ts'], outfile: 'iframe/jlc-core.js', bundle: true, platform: 'browser', format: 'iife', globalName: 'ADR_JLC', target: 'es2020' });
console.log('Built shared offline impedance core');
