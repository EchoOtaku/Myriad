import { trackActivePlaylistItem } from '../../../src/components/ControlPanel/playlistAutoScroll'

const scroller = document.getElementById('playlist')!
for (let i = 0; i < 20; i++) {
  const item = document.createElement('div')
  item.className = `music-playlist-item${i === 12 ? ' active' : ''}`
  item.textContent = `Song ${i}`
  scroller.append(item)
}
let calls = 0
const scroll = scroller.scrollTo.bind(scroller)
scroller.scrollTo = ((options: ScrollToOptions) => { calls++; scroll(options) }) as typeof scroller.scrollTo
let stop = trackActivePlaylistItem(scroller)
Object.assign(window, { playlistGeometryFixture: {
  open: () => { scroller.style.height = '96px' },
  stop: () => stop(),
  select: (index: number) => {
    stop()
    scroller.querySelector('.active')?.classList.remove('active')
    scroller.children[index].classList.add('active')
    stop = trackActivePlaylistItem(scroller)
  },
  snapshot: () => ({ calls, top: scroller.scrollTop }),
} })
