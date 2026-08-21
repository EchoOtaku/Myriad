import assert from 'node:assert/strict'
import test from 'node:test'
import { motionWorkbenchGazeSource } from './motionWorkbenchGaze'

test('workbench gaze source stays none until its reveal gate opens', () => {
  assert.equal(motionWorkbenchGazeSource('camera', false), 'none')
  assert.equal(motionWorkbenchGazeSource('idle-glance', false), 'none')
  assert.equal(motionWorkbenchGazeSource('camera', true), 'camera')
})
