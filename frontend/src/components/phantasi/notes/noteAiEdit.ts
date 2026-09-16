export interface NoteAiDocument {
  identity: string
  title: string
  topic: string | null
  contentMd: string
}
export interface NoteAiSelection { start: number; end: number }
export interface NoteAiRequest {
  title: string
  topic: string | null
  content_md: string
  instruction: string
  locale: string
  selection: { start: number; end: number; text: string } | null
}

export function sameNoteAiDocument(a: NoteAiDocument, b: NoteAiDocument): boolean {
  return a.identity === b.identity && a.title === b.title && a.topic === b.topic && a.contentMd === b.contentMd
}

function validateSelection(source: string, selection: NoteAiSelection) {
  const { start, end } = selection
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length
    || !source.slice(0, start).isWellFormed() || !source.slice(0, end).isWellFormed()) {
    throw new Error('Invalid selection')
  }
}

export function buildNoteAiRequest(document: NoteAiDocument, selection: NoteAiSelection | null, instruction: string, locale: string): NoteAiRequest {
  if (selection) validateSelection(document.contentMd, selection)
  const bytes = (value: string) => new TextEncoder().encode(value).length
  return {
    title: document.title,
    topic: document.topic,
    content_md: document.contentMd,
    instruction,
    locale,
    selection: selection ? {
      start: bytes(document.contentMd.slice(0, selection.start)),
      end: bytes(document.contentMd.slice(0, selection.end)),
      text: document.contentMd.slice(selection.start, selection.end),
    } : null,
  }
}

export function mergeNoteAiResult(source: string, selection: NoteAiSelection | null, replacement: string): string {
  if (!selection) return replacement
  validateSelection(source, selection)
  return source.slice(0, selection.start) + replacement + source.slice(selection.end)
}
