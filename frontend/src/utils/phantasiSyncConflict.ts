export class PhantasiSyncConflictError extends Error {
  constructor(readonly itemId: number, readonly serverRevision?: number) {
    super('Reading state changed on the server')
    this.name = 'PhantasiSyncConflictError'
  }
}
