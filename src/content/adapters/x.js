// X / Twitter timelines: article[data-testid="tweet"]. Virtualised, so entries are re-found on every mutation scan.
import { textWithout } from './scholar.js';

const STATUS = /\/([A-Za-z0-9_]+)\/status\/(\d+)/;

export const xAdapter = {
  id: 'x',
  domain: 'tweet',
  matches: (loc) => /(^|\.)(x|twitter)\.com$/.test(loc.hostname),
  findEntries(root) {
    const out = [];
    for (const art of root.querySelectorAll('article[data-testid="tweet"]')) {
      const textEl = art.querySelector('[data-testid="tweetText"]');
      if (!textEl) continue; // media-only tweets have nothing to judge
      const text = tweetText(textEl);
      if (!text) continue;
      const permalink = [...art.querySelectorAll('a[href*="/status/"]')].find((a) => a.querySelector('time')) || art.querySelector('a[href*="/status/"]');
      const m = (permalink?.getAttribute('href') || '').match(STATUS);
      const userName = art.querySelector('[data-testid="User-Name"]');
      const display = userName?.querySelector('a span')?.textContent?.trim() || '';
      const handle = [...(userName?.querySelectorAll('span') || [])].map((s) => s.textContent.trim()).find((t) => /^@\w+$/.test(t)) || (m ? `@${m[1]}` : '');
      const quoted = [...art.querySelectorAll('[data-testid="tweetText"]')].slice(1).map(tweetText).filter(Boolean)[0] || '';
      const when = art.querySelector('time[datetime]')?.getAttribute('datetime') || '';
      out.push({
        id: m ? m[2] : text,
        containers: [art],
        mount: textEl,
        paper: {
          source: 'x',
          title: text.slice(0, 120),
          abstract: text,
          quotedText: quoted,
          authors: [display, handle].filter(Boolean).join(' '),
          venue: 'X',
          year: when.slice(0, 4),
          url: m ? `https://x.com/${m[1]}/status/${m[2]}` : '',
          tweetId: m ? m[2] : '',
        },
      });
    }
    return out;
  },
};

/** Text of a tweet block, with emoji images restored from their alt text and our badges excluded. */
export function tweetText(el) {
  const clone = el.cloneNode(true);
  for (const n of clone.querySelectorAll('.pt-badge, .pt-review')) n.remove();
  for (const img of clone.querySelectorAll('img[alt]')) img.replaceWith(clone.ownerDocument.createTextNode(img.getAttribute('alt') || ''));
  return clone.textContent.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
