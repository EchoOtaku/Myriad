/**
 * Development source maps double every module (original source as base64). On a
 * 1200-file SPA plus icon barrels that is tens of MB of V8 script source,
 * and HMR keeps the old copies. Production builds still emit maps as usual.
 */
export function stripDevSourcemapsPlugin() {
  return {
    name: 'strip-dev-sourcemaps',
    apply: 'serve',
    enforce: 'post',
    transform(code, id) {
      const path = id.split('?')[0]
      if (
        path.endsWith('.css') ||
        path.endsWith('.scss') ||
        path.endsWith('.less')
      ) {
        return null
      }
      return { code, map: null }
    },
  }
}
