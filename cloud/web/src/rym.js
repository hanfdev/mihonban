import { readRymPage } from './rym-capture.js'

// Saved HTML has no trustworthy observation time, regardless of its file date.
export function parseRymHtml(htmlText) {
  return readRymPage(new DOMParser().parseFromString(htmlText, 'text/html'), null, null)
}
