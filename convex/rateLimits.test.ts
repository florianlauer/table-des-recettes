import { expect, test } from 'vite-plus/test'
import {
  EXTRACTION_RATE,
  SCAN_CREATION_BURST,
  SCAN_CREATION_RATE,
} from './rateLimits'

test('exports the reviewed quota values', () => {
  expect({ SCAN_CREATION_RATE, SCAN_CREATION_BURST, EXTRACTION_RATE }).toEqual({
    SCAN_CREATION_RATE: 30,
    SCAN_CREATION_BURST: 10,
    EXTRACTION_RATE: 60,
  })
})
