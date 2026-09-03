import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { UpperBodyVisualIdentity } from '../../components/agent/onboarding/onboardingTypes'
import {
  applyOutfit,
  hydrateWardrobe,
  parseWardrobe,
  sortWardrobe,
  syncActiveOutfit,
} from './wardrobe'

const outfitA = {
  upperBodySilhouette: '窄肩与清晰领口',
  outfitConstruction: '水手领内搭叠短外套',
  sleeveArmDesign: '宽松袖口包住局部前臂',
  materialPlan: '哑光布料为主',
  heroAccessory: '左侧星形发夹',
  paletteHint: '淡紫与白为主体',
  motif: '星轨集中在发饰',
}

const outfitB = {
  ...outfitA,
  outfitConstruction: '敞开领口内搭叠短风衣',
}

const identity: UpperBodyVisualIdentity = {
  character: {
    faceDesign: '女性化鹅蛋脸',
    eyeDesign: '中等偏大的紫色眼睛',
    hairShape: '银灰齐颌短发',
    hairLayerPlan: '后发、刘海、侧发',
  },
  outfit: outfitA,
}

test('wardrobe parse drops broken items and keeps valid ones', () => {
  const items = parseWardrobe([
    { id: 'w-a', clothingStyle: 'urban', outfit: outfitA },
    { id: 'w-a', clothingStyle: 'idol', outfit: outfitB },
    { id: 'w-b', clothingStyle: 'not-a-style', outfit: outfitB },
    { id: 'w-c', clothingStyle: 'idol', outfit: outfitB },
  ])
  assert.equal(items.length, 2)
  assert.equal(items[0].id, 'w-a')
  assert.equal(items[1].id, 'w-c')
  assert.equal(items[1].clothingStyle, 'idol')
})

test('hydrate seeds the live outfit when the wardrobe is empty', () => {
  const seeded = hydrateWardrobe(
    { gender: 'female', clothingStyle: 'urban', visualIdentity: identity },
    identity,
  )
  assert.equal(seeded.items.length, 1)
  assert.equal(seeded.items[0].clothingStyle, 'urban')
  assert.equal(seeded.activeId, 'live')

  const stored = hydrateWardrobe(
    {
      clothingStyle: 'idol',
      wardrobe: [
        { id: 'w-a', clothingStyle: 'urban', outfit: outfitA },
        { id: 'w-b', clothingStyle: 'idol', outfit: outfitB },
      ],
      activeOutfitId: 'w-b',
    },
    { ...identity, outfit: outfitB },
  )
  assert.equal(stored.activeId, 'w-b')
  assert.equal(stored.items.length, 2)
})

test('apply swaps only the outfit module', () => {
  const next = applyOutfit(identity, {
    id: 'w-b',
    clothingStyle: 'idol',
    outfit: outfitB,
  })
  assert.deepEqual(next.character, identity.character)
  assert.equal(next.outfit.outfitConstruction, outfitB.outfitConstruction)
})

test('editing the live identity writes back into the active wardrobe item', () => {
  const items = [
    { id: 'w-a', clothingStyle: 'urban' as const, outfit: outfitA },
  ]
  const edited = { ...identity, outfit: outfitB }
  const synced = syncActiveOutfit(items, 'w-a', edited)
  assert.equal(synced[0].outfit.outfitConstruction, outfitB.outfitConstruction)
})

test('wardrobe sets are ordered by clothing family', () => {
  const ordered = sortWardrobe([
    { id: 'w-2', clothingStyle: 'idol', outfit: outfitA },
    { id: 'w-1', clothingStyle: 'everyday', outfit: outfitA },
    { id: 'w-3', clothingStyle: 'urban', outfit: outfitA },
  ])
  assert.deepEqual(
    ordered.map((item) => item.clothingStyle),
    ['everyday', 'urban', 'idol'],
  )
})

test('the wardrobe lives in settings, not in the onboarding wizard', () => {
  const workbench = readFileSync(
    new URL('./SiteMotionWorkbench.tsx', import.meta.url),
    'utf8',
  )
  const wizard = readFileSync(
    new URL(
      '../../components/agent/onboarding/OnboardingWizard.tsx',
      import.meta.url,
    ),
    'utf8',
  )
  const tabs = readFileSync(
    new URL('./anime25drig/Anime25DWorkbench.tsx', import.meta.url),
    'utf8',
  )
  assert.match(workbench, /OutfitWardrobe/)
  assert.match(workbench, /show="outfit"/)
  assert.match(workbench, /show="character"/)
  assert.doesNotMatch(wizard, /OutfitWardrobe|wardrobe/)
  assert.match(tabs, /value: 'wardrobe'/)
  assert.doesNotMatch(tabs, /value: 'portrait'/)
  assert.doesNotMatch(tabs, /value: 'rig'/)
})
