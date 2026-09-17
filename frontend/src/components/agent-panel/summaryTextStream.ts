/**
 * Incrementally separates thought/action syntax before text enters the disk store.
 * Only an incomplete delimiter is retained across chunks, never the transcript.
 */
export class SummaryTextStream {
  private tail = ''
  private state: 'content' | 'thought' | 'marker' = 'content'
  private markerEnd = ']]'
  private hadContent = false
  private separateReply = false
  get retainedChars() { return this.tail.length }
  push(chunk: string, done = false): { content: string; thought: string } {
    let input = this.tail + chunk
    this.tail = ''
    const result = { content: '', thought: '' }
    const emit = (text: string) => {
      if (!text || this.state === 'marker') return
      if (this.state === 'content') {
        if (this.separateReply) { result.content += '\n\n'; this.separateReply = false }
        this.hadContent = true
      }
      result[this.state] += text
    }
    while (input) {
      const delimiters = this.state === 'thought' ? ['</think>'] : this.state === 'marker' ? [this.markerEnd] : ['<think>', '[[wear:', '[[music:', '⟦wear:']
      const lower = input.toLowerCase()
      let index = -1; let delimiter = ''
      for (const candidate of delimiters) {
        const found = lower.indexOf(candidate)
        if (found >= 0 && (index < 0 || found < index)) { index = found; delimiter = candidate }
      }
      if (index >= 0) {
        emit(input.slice(0, index))
        input = input.slice(index + delimiter.length)
        if (this.state !== 'content') {
          if (this.state === 'thought' && this.hadContent) this.separateReply = true
          this.state = 'content'
        }
        else if (delimiter === '<think>') {
          this.state = 'thought'
        }
        else { this.state = 'marker'; this.markerEnd = delimiter === '⟦wear:' ? '⟧' : ']]' }
        continue
      }
      let held = 0
      if (!done) {
        for (const delimiter of delimiters) {
          for (let size = 1; size < delimiter.length && size <= input.length; size++) {
            if (lower.endsWith(delimiter.slice(0, size))) held = Math.max(held, size)
          }
        }
      }
      emit(input.slice(0, input.length - held))
      this.tail = held ? input.slice(-held) : ''
      break
    }
    return result
  }
}
