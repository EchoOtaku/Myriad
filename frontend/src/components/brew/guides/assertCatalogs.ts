import type { BrewGuidesCatalog } from './types'
import catalogDe from './catalog.de-DE.json' with { type: 'json' }
import catalogEn from './catalog.en-US.json' with { type: 'json' }
import catalogFr from './catalog.fr-FR.json' with { type: 'json' }
import catalogJa from './catalog.ja-JP.json' with { type: 'json' }
import catalogKo from './catalog.ko-KR.json' with { type: 'json' }
import catalogZh from './catalog.zh-CN.json' with { type: 'json' }
import catalogTw from './catalog.zh-TW.json' with { type: 'json' }

const _catalogEn: BrewGuidesCatalog = catalogEn
const _catalogZh: BrewGuidesCatalog = catalogZh
const _catalogTw: BrewGuidesCatalog = catalogTw
const _catalogJa: BrewGuidesCatalog = catalogJa
const _catalogKo: BrewGuidesCatalog = catalogKo
const _catalogFr: BrewGuidesCatalog = catalogFr
const _catalogDe: BrewGuidesCatalog = catalogDe

void _catalogEn
void _catalogZh
void _catalogTw
void _catalogJa
void _catalogKo
void _catalogFr
void _catalogDe
