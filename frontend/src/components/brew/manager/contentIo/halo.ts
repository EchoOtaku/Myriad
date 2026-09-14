import type { TransferNote } from './types'
import { fileSlug, parseUnixOrDate } from './text'

interface HaloPost {
  spec?: {
    title?: string
    slug?: string
    publish?: boolean
    publishTime?: string
    tags?: string[]
    categories?: Array<string | { spec?: { displayName?: string } }>
  }
  status?: string | { phase?: string }
  content?: { raw?: string; rawType?: string }
  title?: string
  content_md?: string
  topic?: string | null
  published_at?: number | null
}

function haloTopic(post: HaloPost): string | null {
  const tags = post.spec?.tags
  if (Array.isArray(tags) && tags[0]) return String(tags[0])
  const cats = post.spec?.categories
  if (!Array.isArray(cats) || !cats[0]) return post.topic?.trim() || null
  const first = cats[0]
  if (typeof first === 'string') return first
  return first.spec?.displayName?.trim() || null
}

function haloPublished(post: HaloPost): boolean {
  if (post.spec?.publish === true) return true
  const phase =
    (typeof post.status === 'object' && post.status?.phase) ||
    (typeof post.status === 'string' ? post.status : '')
  return String(phase).toUpperCase() === 'PUBLISHED'
}

function fromHaloPost(post: HaloPost): TransferNote {
  if (typeof post.content_md === 'string') {
    return {
      title: post.title ?? '',
      content_md: post.content_md,
      topic: post.topic ?? null,
      published_at: post.published_at ?? null,
      status: post.status === 'published' ? 'published' : 'draft',
    }
  }
  return {
    title: post.spec?.title ?? post.title ?? '',
    content_md: post.content?.raw ?? '',
    topic: haloTopic(post),
    published_at: parseUnixOrDate(post.spec?.publishTime),
    status: haloPublished(post) ? 'published' : 'draft',
  }
}

export function parseHaloJson(raw: string): TransferNote[] {
  const data = JSON.parse(raw) as
    HaloPost[] | { posts?: HaloPost[]; notes?: HaloPost[] }
  const posts = Array.isArray(data)
    ? data
    : Array.isArray(data.posts)
      ? data.posts
      : Array.isArray(data.notes)
        ? data.notes
        : []
  return posts
    .map(fromHaloPost)
    .filter((note) => note.title.trim() !== '' || note.content_md.trim() !== '')
}

export function serializeHaloJson(notes: readonly TransferNote[]): string {
  return `${JSON.stringify(
    {
      format: 'halo.content.v1',
      posts: notes.map((note, index) => ({
        spec: {
          title: note.title || `note-${index + 1}`,
          slug: fileSlug(note.title, index),
          publish: note.status === 'published',
          publishTime: note.published_at
            ? new Date(note.published_at * 1000).toISOString()
            : undefined,
          tags: note.topic ? [note.topic] : [],
        },
        status: {
          phase: note.status === 'published' ? 'PUBLISHED' : 'DRAFT',
        },
        content: {
          raw: note.content_md,
          rawType: 'markdown',
        },
      })),
    },
    null,
    2,
  )}\n`
}
