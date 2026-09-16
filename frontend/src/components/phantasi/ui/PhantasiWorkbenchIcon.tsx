export type PhantasiWorkbenchIconKind =
  | 'studio'
  | 'overview'
  | 'notes'
  | 'comments'
  | 'media'
  | 'notes-transfer'
  | 'sources'
  | 'rsshub'
  | 'feeds-transfer'
  | 'reviews'

export function PhantasiWorkbenchIcon({ kind }: { kind: PhantasiWorkbenchIconKind }) {
  return (
    <img
      className="phantasi-workbench-icon"
      width={20}
      height={20}
      src={`/icons/phantasi/workbench-${kind}.webp`}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
    />
  )
}
