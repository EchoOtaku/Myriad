export function isStoreAppAvailable(
  app: { permissions?: readonly string[] },
  federationEnabled: boolean,
): boolean {
  return federationEnabled || !app.permissions?.some(permission => permission.startsWith('federation:'))
}
