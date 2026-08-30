/** Production live-face mount. Default true so tests without a rig still speak. */
let visible = true

export function setLiveFaceVisible(value: boolean): void {
  visible = value
}

export function liveFaceVisible(): boolean {
  return visible
}
