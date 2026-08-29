const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function build() {
  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    platform: 'node',
    format: 'cjs',
    sourcemap: true,
  });

  const webviewCtx = await esbuild.context({
    entryPoints: ['src/webview/index.tsx'],
    bundle: true,
    outfile: 'webview-dist/index.js',
    platform: 'browser',
    format: 'iife',
    sourcemap: true,
  });

  if (watch) {
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
    console.log('esbuild watching extension.ts and webview/index.tsx ...');
  } else {
    await extensionCtx.rebuild();
    await webviewCtx.rebuild();
    await extensionCtx.dispose();
    await webviewCtx.dispose();
  }
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
