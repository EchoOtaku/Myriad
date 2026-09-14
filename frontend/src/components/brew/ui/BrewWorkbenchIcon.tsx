export type BrewWorkbenchIconKind =
  | 'studio'
  | 'overview'
  | 'notes'
  | 'media'
  | 'notes-transfer'
  | 'sources'
  | 'rsshub'
  | 'feeds-transfer'

export function BrewWorkbenchIcon({ kind }: { kind: BrewWorkbenchIconKind }) {
  return (
    <img
      className="brew-workbench-icon"
      width={20}
      height={20}
      src={`/icons/brew/workbench-${kind}.webp`}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
    />
  )
}
