// SVG Optimizer — runs SVGO on one SVG string and returns plain data that can be posted
// across a worker boundary. Used by svg-optimizer.worker.js and by the main-thread
// fallback in SvgOptimizerTool.astro. `svgo` is the module namespace of `svgo/browser`.
export function runSvgo(svgo, text, config) {
  try {
    const result = svgo.optimize(text, config);
    return { data: result.data, version: svgo.VERSION };
  } catch (err) {
    return {
      error: {
        name: (err && err.name) || 'Error',
        message: String((err && err.message) || err),
        line: err && typeof err.line === 'number' ? err.line : null,
        column: err && typeof err.column === 'number' ? err.column : null,
        reason: err && err.reason ? String(err.reason) : null,
      },
      version: svgo.VERSION,
    };
  }
}
