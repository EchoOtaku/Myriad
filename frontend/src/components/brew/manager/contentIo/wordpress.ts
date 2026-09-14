import type { TransferNote } from './types'
import {
  escapeXml,
  htmlToMarkdown,
  markdownToHtml,
  parseUnixOrDate,
  xmlBlocks,
  xmlInner,
} from './text'

const SKIP_TYPES = new Set(['attachment', 'nav_menu_item', 'revision'])

export function parseWordpressXml(xml: string): TransferNote[] {
  return xmlBlocks(xml, 'item')
    .map((item) => {
      const type = xmlInner(item, 'wp:post_type') || 'post'
      if (SKIP_TYPES.has(type)) return null
      const statusRaw = xmlInner(item, 'wp:status').toLowerCase()
      const title = xmlInner(item, 'title')
      const html =
        xmlInner(item, 'content:encoded') || xmlInner(item, 'description')
      const topic =
        xmlInner(item, 'category') || xmlInner(item, 'wp:post_name') || null
      const published = parseUnixOrDate(
        xmlInner(item, 'wp:post_date_gmt') ||
          xmlInner(item, 'wp:post_date') ||
          xmlInner(item, 'pubDate'),
      )
      const note: TransferNote = {
        title,
        content_md: htmlToMarkdown(html),
        topic: topic?.trim() || null,
        published_at: published,
        status: statusRaw === 'publish' ? 'published' : 'draft',
      }
      return note
    })
    .filter(
      (note): note is TransferNote =>
        note != null &&
        (note.title.trim() !== '' || note.content_md.trim() !== ''),
    )
}

export function serializeWordpressXml(
  notes: readonly TransferNote[],
  siteTitle: string,
): string {
  const items = notes
    .map((note, index) => {
      const date = note.published_at
        ? new Date(note.published_at * 1000)
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ')
        : ''
      const topic = note.topic
        ? `\n    <category><![CDATA[${note.topic}]]></category>`
        : ''
      return `  <item>
    <title><![CDATA[${note.title || `note-${index + 1}`}]]></title>
    <content:encoded><![CDATA[${markdownToHtml(note.content_md)}]]></content:encoded>
    <wp:post_type>post</wp:post_type>
    <wp:status>${note.status === 'published' ? 'publish' : 'draft'}</wp:status>
    <wp:post_date_gmt>${escapeXml(date)}</wp:post_date_gmt>${topic}
  </item>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title><![CDATA[${siteTitle}]]></title>
  <wp:wxr_version>1.2</wp:wxr_version>
${items}
</channel>
</rss>
`
}
