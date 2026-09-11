export function storePackageRoot(codeOrManifestPath: string): string {
  const path = codeOrManifestPath.trim().replace(/^\/+/, '')
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(0, i) : ''
}

export function storeAssetStorePath(
  packageRoot: string,
  assetPath: string,
): string {
  const asset = assetPath.trim().replace(/^\/+/, '')
  const root = packageRoot.trim().replace(/^\/+|\/+$/g, '')
  return root ? `${root}/${asset}` : asset
}
