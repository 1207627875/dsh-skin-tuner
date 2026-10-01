/**
 * Build the browser half into the single file the client loader expects.
 *
 * Format: the DSH client module loader wraps each plugin bundle as
 * `window.__ModuleLoader__.load({ id, factory })`; the banner/footer below
 * produce exactly that around esbuild's CommonJS output. React and the client
 * runtime stay external because the app owns those instances — bundling a
 * second copy would break hooks.
 */
import { build } from 'esbuild'

const id = 'dsh-skin-tuner'

const result = await build({
  entryPoints: ['src/client/index.jsx'],
  outfile: 'client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  legalComments: 'none',
  loader: { '.css': 'text' },
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-runtime/client'],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: {
    js: `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
  },
  footer: {
    js: 'return module.exports;}});',
  },
  metafile: true,
})

const [output] = Object.values(result.metafile.outputs)
console.log(`built client.js - ${(output.bytes / 1024).toFixed(1)} KiB`)
